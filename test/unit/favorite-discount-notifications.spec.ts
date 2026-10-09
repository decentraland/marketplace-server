import { ILoggerComponent } from '@well-known-components/interfaces'
import { PoolClient } from 'pg'
import { Events } from '@dcl/schemas'
import {
  Candidate,
  FavoriteDiscountNotificationsDeps,
  ITEM_DISCOUNTED_SUBTYPE,
  PendingCoupon,
  runFavoriteDiscountNotifications,
  selectNotifications,
  toItemDiscountedEvent
} from '../../src/logic/favorite-discount-notifications'
import { ShopListing } from '../../src/ports/shop-catalog/types'

const COUPON_ID = '7f1c0d1e-0000-4000-8000-000000000001'
const CONTRACT = '0xcollection'
const CREATOR = '0xcreator'

function listing(itemId: string, overrides: Partial<ShopListing> = {}): ShopListing {
  return {
    tradeId: `trade-${itemId}`,
    listingType: 'primary',
    contractAddress: CONTRACT,
    itemId,
    tokenId: null,
    name: `Item ${itemId}`,
    thumbnail: `https://img.example/${itemId}.png`,
    rarity: 'epic',
    category: 'wearable',
    wearableCategory: 'hat',
    gender: 'unisex',
    creator: CREATOR,
    seller: null,
    issuedId: null,
    priceCredits: 70,
    compareAtCredits: 100,
    saleEndsAt: 1,
    saleUnitsLeft: 10,
    coupon: { id: COUPON_ID } as ShopListing['coupon'],
    available: 10,
    network: 'MATIC',
    chainId: 137,
    createdAt: 1,
    ...overrides
  }
}

function candidate(user: string, itemId: string, favoritedAt: number): Candidate {
  return { userAddress: user, contractAddress: CONTRACT, itemId, favoritedAt: new Date(favoritedAt), listing: listing(itemId) }
}

describe('when selecting which favorites to notify for a coupon', () => {
  it('should notify each favorited item once, newest favorites first, up to three per user per day', () => {
    const selected = selectNotifications(
      [candidate('0xa', '1', 1), candidate('0xa', '2', 4), candidate('0xa', '3', 3), candidate('0xa', '4', 2), candidate('0xa', '2', 5)],
      new Set(),
      new Map()
    )

    expect(selected.map(c => c.itemId)).toEqual(['2', '3', '4'])
  })

  it('should count what the user was already sent today against the cap', () => {
    const selected = selectNotifications(
      [candidate('0xa', '1', 1), candidate('0xa', '2', 2), candidate('0xb', '1', 1)],
      new Set(),
      new Map([['0xa', 2]])
    )

    expect(selected.map(c => `${c.userAddress}:${c.itemId}`)).toEqual(['0xa:2', '0xb:1'])
  })

  it('should skip an item already notified for this coupon', () => {
    const selected = selectNotifications([candidate('0xa', '1', 1), candidate('0xa', '2', 2)], new Set([`0xa:${CONTRACT}-2`]), new Map())

    expect(selected.map(c => c.itemId)).toEqual(['1'])
  })
})

describe('when building the event for a notification', () => {
  const coupon: PendingCoupon = {
    id: COUPON_ID,
    discountPpm: 300_000,
    collections: [CONTRACT],
    effectiveSince: new Date(0),
    expiresAt: new Date(2_000_000)
  }

  it('should address the favoriting user with the sale details and a link to the item in the Shop', () => {
    const event = toItemDiscountedEvent(candidate('0xa', '1', 1), coupon, 'https://decentraland.org/shop/', 1_000) as unknown as Record<
      string,
      unknown
    >

    expect(event).toEqual({
      type: Events.Type.MARKETPLACE,
      subType: ITEM_DISCOUNTED_SUBTYPE,
      key: `item-discounted-${COUPON_ID}-${CONTRACT}-1-0xa`,
      timestamp: 1_000,
      metadata: {
        address: '0xa',
        image: 'https://img.example/1.png',
        category: 'wearable',
        rarity: 'epic',
        nftName: 'Item 1',
        contractAddress: CONTRACT,
        itemId: '1',
        link: `https://decentraland.org/shop/item/${CONTRACT}/1`,
        discountPct: 30,
        listPrice: '100',
        salePrice: '70',
        endsAt: 2_000_000,
        title: 'A favorite is on sale',
        description: 'Item 1 is 30% off.',
        network: 'MATIC'
      }
    })
  })
})

describe('when running the favorite discount notifications', () => {
  let queries: { text: string; values?: unknown[] }[]
  let client: PoolClient
  let deps: FavoriteDiscountNotificationsDeps
  let publish: jest.Mock
  let getShopListings: jest.Mock
  let warn: jest.Mock
  let release: jest.Mock
  let lockAcquired: boolean
  let pending: object[]
  let sentToday: object[]

  beforeEach(() => {
    queries = []
    lockAcquired = true
    pending = [
      {
        id: COUPON_ID,
        discount_ppm: 300_000,
        collections: [CONTRACT],
        effective_since: new Date(Date.now() - 3_600_000),
        expires_at: new Date(Date.now() + 86_400_000)
      }
    ]
    sentToday = []
    client = {
      query: jest.fn(async (text: string, values?: unknown[]) => {
        queries.push({ text, values })
        if (text.includes('pg_try_advisory_lock')) return { rows: [{ acquired: lockAcquired }] }
        if (text.includes('ORDER BY c.discount_ppm')) return { rows: pending }
        if (text.includes('COUNT(*)::int AS sent')) return { rows: sentToday }
        if (text.includes('INSERT INTO marketplace.favorite_discount_notifications')) {
          const rows = JSON.parse(values?.[0] as string)
          return { rows }
        }
        return { rows: [] }
      }),
      release: (release = jest.fn())
    } as unknown as PoolClient
    publish = jest.fn().mockResolvedValue('message-id')
    warn = jest.fn()
    deps = {
      connect: async () => client,
      getShopListings: (getShopListings = jest.fn().mockResolvedValue({
        data: [
          listing('1'),
          listing('2', { coupon: { id: 'another-coupon' } as ShopListing['coupon'] }),
          listing('3', { priceCredits: 1, compareAtCredits: 1 })
        ],
        total: 3
      })),
      getFavoriters: jest.fn().mockResolvedValue([
        { userAddress: '0xFAN', itemKey: `${CONTRACT}-1`, favoritedAt: new Date(1) },
        { userAddress: CREATOR, itemKey: `${CONTRACT}-1`, favoritedAt: new Date(1) }
      ]),
      publish,
      logger: {
        info: jest.fn(),
        warn,
        error: jest.fn(),
        debug: jest.fn(),
        log: jest.fn()
      } as unknown as ILoggerComponent.ILogger,
      shopBaseUrl: 'https://decentraland.org/shop'
    }
  })

  describe('and another replica holds the lock', () => {
    beforeEach(() => {
      lockAcquired = false
    })

    it('should step aside without reading or sending anything', async () => {
      expect(await runFavoriteDiscountNotifications(deps)).toEqual({ outcome: 'skipped' })
      expect(getShopListings).not.toHaveBeenCalled()
      expect(publish).not.toHaveBeenCalled()
      expect(release).toHaveBeenCalled()
    })
  })

  describe('and a coupon just started', () => {
    it('should notify the fans of the items it lowers, but not the creator nor items another coupon or rounding leaves alone', async () => {
      expect(await runFavoriteDiscountNotifications(deps)).toEqual({ outcome: 'ran', coupons: 1, sent: 1 })

      expect(deps.getFavoriters).toHaveBeenCalledWith([`${CONTRACT}-1`])
      expect(publish).toHaveBeenCalledTimes(1)
      expect(publish.mock.calls[0][0]).toMatchObject({ subType: ITEM_DISCOUNTED_SUBTYPE, metadata: { address: '0xfan', itemId: '1' } })
    })

    it('should record the notification before publishing it, and mark the coupon announced', async () => {
      await runFavoriteDiscountNotifications(deps)

      const texts = queries.map(q => q.text)
      const insert = texts.findIndex(t => t.includes('INSERT INTO marketplace.favorite_discount_notifications'))
      const announced = texts.findIndex(t => t.includes('SET favorites_notified_at = now() WHERE id = $1'))
      expect(insert).toBeGreaterThan(-1)
      expect(announced).toBeGreaterThan(insert)
      expect(texts.some(t => t.includes('pg_advisory_unlock'))).toBe(true)
    })
  })

  describe('and the fan already got three notifications today', () => {
    beforeEach(() => {
      sentToday = [{ user_address: '0xfan', sent: 3 }]
    })

    it('should send nothing and still mark the coupon announced', async () => {
      expect(await runFavoriteDiscountNotifications(deps)).toEqual({ outcome: 'ran', coupons: 1, sent: 0 })
      expect(publish).not.toHaveBeenCalled()
      expect(queries.some(q => q.text.includes('WHERE id = $1'))).toBe(true)
    })
  })

  describe('and the catalogue does not show the coupon yet', () => {
    beforeEach(() => {
      getShopListings.mockResolvedValue({ data: [], total: 0 })
    })

    it('should leave a coupon that just started pending, so the next run tries again', async () => {
      pending = [{ ...pending[0], effective_since: new Date(Date.now() - 60_000) }]

      await runFavoriteDiscountNotifications(deps)

      expect(queries.some(q => q.text.includes('WHERE id = $1'))).toBe(false)
    })

    it('should give up on it once the grace period is over', async () => {
      await runFavoriteDiscountNotifications(deps)

      expect(queries.some(q => q.text.includes('WHERE id = $1'))).toBe(true)
    })
  })

  describe('and the catalogue fails for one coupon', () => {
    beforeEach(() => {
      pending = [pending[0], { ...pending[0], id: 'second-coupon' }]
      getShopListings.mockRejectedValueOnce(new Error('timeout'))
    })

    it('should log it, leave that coupon pending and still announce the next one', async () => {
      expect(await runFavoriteDiscountNotifications(deps)).toEqual({ outcome: 'ran', coupons: 2, sent: 0 })

      const announced = queries.filter(q => q.text.includes('WHERE id = $1')).map(q => q.values?.[0])
      expect(announced).toEqual(['second-coupon'])
    })
  })

  describe('and the pending coupons are read', () => {
    it('should leave out exhausted, cancelled and revoked coupons', async () => {
      await runFavoriteDiscountNotifications(deps)

      const select = queries.find(q => q.text.includes('ORDER BY c.discount_ppm'))?.text ?? ''
      expect(select).toContain("COALESCE(s.uses, 0) < (c.checks->>'uses')::numeric")
      expect(select).toContain('NOT COALESCE(s.cancelled, false)')
      expect(select).toContain('NOT COALESCE(s.revoked, false)')
    })
  })

  describe('and publishing fails', () => {
    beforeEach(() => {
      publish.mockRejectedValue(new Error('sns down'))
    })

    it('should log it and keep going rather than fail the run', async () => {
      expect(await runFavoriteDiscountNotifications(deps)).toEqual({ outcome: 'ran', coupons: 1, sent: 0 })
      expect(warn).toHaveBeenCalled()
    })
  })
})
