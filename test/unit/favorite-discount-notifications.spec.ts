import { ILoggerComponent } from '@well-known-components/interfaces'
import { PoolClient } from 'pg'
import { Events } from '@dcl/schemas'
import {
  Candidate,
  FavoriteDiscountNotificationsDeps,
  ITEM_COOLDOWN_MS,
  ITEM_DISCOUNTED_SUBTYPE,
  MAX_ANNOUNCE_AGE_MS,
  MAX_ATTEMPTS,
  MIN_TIME_LEFT_MS,
  PendingCoupon,
  runFavoriteDiscountNotifications,
  selectNotifications,
  toItemDiscountedEvent
} from '../../src/logic/favorite-discount-notifications'
import { ShopListing } from '../../src/ports/shop-catalog/types'

const COUPON_ID = '7f1c0d1e-0000-4000-8000-000000000001'
const CONTRACT = '0xcollection'
const CREATOR = '0xcreator'
const ANNOUNCED = 'SET favorites_notified_at = now() WHERE id = $1'
const DEFERRED = 'favorites_attempts = favorites_attempts + 1'

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
  let query: jest.Mock
  let respond: (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }>
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
      query: (query = jest.fn(
        (respond = async (text: string, values?: unknown[]) => {
          queries.push({ text, values })
          if (text.includes('pg_try_advisory_lock')) return { rows: [{ acquired: lockAcquired }] }
          if (text.includes('ORDER BY c.favorites_attempts')) return { rows: pending }
          if (text.includes('COUNT(*)::int AS sent')) return { rows: sentToday }
          if (text.includes('INSERT INTO marketplace.favorite_discount_notifications')) {
            const rows = JSON.parse(values?.[0] as string)
            return { rows }
          }
          return { rows: [] }
        })
      )),
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

    it('should record the notification before publishing it, and mark the coupon announced only after', async () => {
      const order: string[] = []
      query.mockImplementation(async (text: string, values?: unknown[]) => {
        if (text.includes('INSERT INTO marketplace.favorite_discount_notifications')) order.push('insert')
        if (text.includes(ANNOUNCED)) order.push('announce')
        return respond(text, values)
      })
      publish.mockImplementation(async () => {
        order.push('publish')
        return 'message-id'
      })

      await runFavoriteDiscountNotifications(deps)

      expect(order).toEqual(['insert', 'publish', 'announce'])
      expect(queries.some(q => q.text.includes('pg_advisory_unlock'))).toBe(true)
    })
  })

  describe('and the fan heard about the same item under another coupon this week', () => {
    it('should not announce it again', async () => {
      query.mockImplementation(async (text: string, values?: unknown[]) => {
        if (text.includes('sent_at > now() - $3')) {
          queries.push({ text, values })
          return { rows: [{ user_address: '0xfan', contract_address: CONTRACT, item_id: '1' }] }
        }
        return respond(text, values)
      })

      expect(await runFavoriteDiscountNotifications(deps)).toEqual({ outcome: 'ran', coupons: 1, sent: 0 })
      const done = queries.find(q => q.text.includes('sent_at > now() - $3'))
      expect(done?.values).toEqual([['0xfan'], COUPON_ID, ITEM_COOLDOWN_MS])
    })
  })

  describe('and a coupon was signed with a start in the past', () => {
    it('should date it from its creation for the grace period and the age cap', async () => {
      await runFavoriteDiscountNotifications(deps)

      const select = queries.find(q => q.text.includes('ORDER BY c.favorites_attempts'))?.text ?? ''
      expect(select).toContain('GREATEST(c.effective_since, c.created_at) AS effective_since')
      const close = queries.find(q => q.text.includes('c.favorites_attempts >= $3'))?.text ?? ''
      expect(close).toContain('GREATEST(c.effective_since, c.created_at) <= now() - $2')
    })
  })

  describe('and the fan already got three notifications today', () => {
    beforeEach(() => {
      sentToday = [{ user_address: '0xfan', sent: 3 }]
    })

    it('should send nothing and still mark the coupon announced', async () => {
      expect(await runFavoriteDiscountNotifications(deps)).toEqual({ outcome: 'ran', coupons: 1, sent: 0 })
      expect(publish).not.toHaveBeenCalled()
      expect(queries.some(q => q.text.includes(ANNOUNCED))).toBe(true)
    })
  })

  describe('and the catalogue does not show the coupon yet', () => {
    beforeEach(() => {
      getShopListings.mockResolvedValue({ data: [], total: 0 })
    })

    it('should leave a coupon that just started pending, deferred so it does not hold a slot meanwhile', async () => {
      pending = [{ ...pending[0], effective_since: new Date(Date.now() - 60_000) }]

      await runFavoriteDiscountNotifications(deps)

      expect(queries.some(q => q.text.includes(ANNOUNCED))).toBe(false)
      expect(queries.find(q => q.text.includes(DEFERRED))?.values?.[0]).toBe(COUPON_ID)
    })

    it('should give up on it once the grace period is over', async () => {
      await runFavoriteDiscountNotifications(deps)

      expect(queries.some(q => q.text.includes(ANNOUNCED))).toBe(true)
    })
  })

  describe('and the catalogue fails for one coupon', () => {
    beforeEach(() => {
      pending = [pending[0], { ...pending[0], id: 'second-coupon' }]
      getShopListings.mockRejectedValueOnce(new Error('timeout'))
    })

    it('should log it, leave that coupon pending and still announce the next one', async () => {
      expect(await runFavoriteDiscountNotifications(deps)).toEqual({ outcome: 'ran', coupons: 2, sent: 0 })

      const announced = queries.filter(q => q.text.includes(ANNOUNCED)).map(q => q.values?.[0])
      expect(announced).toEqual(['second-coupon'])
      const deferred = queries.filter(q => q.text.includes(DEFERRED)).map(q => q.values?.[0])
      expect(deferred).toEqual([COUPON_ID])
    })
  })

  describe('and the pending coupons are read', () => {
    it('should leave out exhausted, cancelled and revoked coupons', async () => {
      await runFavoriteDiscountNotifications(deps)

      const select = queries.find(q => q.text.includes('ORDER BY c.favorites_attempts'))?.text ?? ''
      expect(select).toContain("COALESCE(s.uses, 0) < (c.checks->>'uses')::numeric")
      expect(select).toContain('NOT COALESCE(s.cancelled, false)')
      expect(select).toContain('NOT COALESCE(s.revoked, false)')
    })

    it('should skip deferred coupons and read the least-retried first, so failing ones cannot starve the rest', async () => {
      await runFavoriteDiscountNotifications(deps)

      const select = queries.find(q => q.text.includes('ORDER BY c.favorites_attempts ASC'))?.text ?? ''
      expect(select).toContain('favorites_next_attempt_at <= now()')
    })

    it('should give up on coupons that started too long ago or were retried too often', async () => {
      await runFavoriteDiscountNotifications(deps)

      const close = queries.find(q => q.text.includes('WHERE c.favorites_notified_at IS NULL') && q.text.includes('UPDATE'))
      expect(close?.text).toContain('GREATEST(c.effective_since, c.created_at) <= now() - $2')
      expect(close?.text).toContain('c.favorites_attempts >= $3')
      expect(close?.values).toEqual([MIN_TIME_LEFT_MS, MAX_ANNOUNCE_AGE_MS, MAX_ATTEMPTS])
    })
  })

  describe('and a collection has more discounted listings than one page', () => {
    it('should page by the total and not announce a listing twice when pages overlap', async () => {
      getShopListings
        .mockResolvedValueOnce({ data: [listing('1')], total: 1500 })
        .mockResolvedValueOnce({ data: [listing('1')], total: 1500 })

      expect(await runFavoriteDiscountNotifications(deps)).toEqual({ outcome: 'ran', coupons: 1, sent: 1 })
      expect(getShopListings).toHaveBeenCalledTimes(2)
      expect(getShopListings.mock.calls[1][0]).toMatchObject({ skip: 1000, sortBy: 'discount' })
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
