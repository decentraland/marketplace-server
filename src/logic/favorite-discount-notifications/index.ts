import { ILoggerComponent } from '@well-known-components/interfaces'
import { PoolClient } from 'pg'
import { Event, Events } from '@dcl/schemas'
import { ShopCatalogFilters, ShopListing, SHOP_MAX_PAGE_SIZE } from '../../ports/shop-catalog/types'

/** Session advisory lock key: every replica runs the job, only one announces at a time. */
const ADVISORY_LOCK_KEY = 8_421_413
export const FAVORITE_DISCOUNT_NOTIFICATIONS_INTERVAL_MS = 5 * 60 * 1000
/** A user hears about at most this many favorites going on sale per rolling day. */
export const MAX_NOTIFICATIONS_PER_USER_PER_DAY = 3
/** A sale about to end is not worth interrupting anyone for. */
export const MIN_TIME_LEFT_MS = 6 * 60 * 60 * 1000
const COUPONS_PER_RUN = 20
/**
 * The catalogue is read from a replica and a materialized view, which can trail a coupon that just started:
 * a coupon whose items are not visible yet is retried for this long before it is given up on.
 */
export const CATALOGUE_GRACE_MS = 30 * 60 * 1000
/**
 * A coupon the job could not settle (its items not visible yet, or the catalogue failing) is retried with a
 * doubling delay from this one, and given up on after {@link MAX_ATTEMPTS}. Fresh coupons are read first, so
 * a few that keep failing cannot hold back the rest.
 */
const RETRY_BASE_MS = FAVORITE_DISCOUNT_NOTIFICATIONS_INTERVAL_MS
export const MAX_ATTEMPTS = 6
/** A discount that started longer ago than this is not news, whatever kept it from being announced. */
export const MAX_ANNOUNCE_AGE_MS = 24 * 60 * 60 * 1000
const ADDRESS_CHUNK = 5_000
const PUBLISH_CONCURRENCY = 10

/**
 * `Events.SubType.Marketplace.ITEM_DISCOUNTED` and its event type are defined in @dcl/schemas 27.3+; this repo
 * still pins 19.x, so the event is built with the same subtype string and shape.
 */
export const ITEM_DISCOUNTED_SUBTYPE = 'item-discounted'

export type PendingCoupon = {
  id: string
  discountPpm: number
  collections: string[]
  effectiveSince: Date
  expiresAt: Date
}

export type Candidate = {
  userAddress: string
  contractAddress: string
  itemId: string
  favoritedAt: Date
  listing: ShopListing
}

export type FavoriteDiscountNotificationsDeps = {
  connect: () => Promise<PoolClient>
  getShopListings: (filters: ShopCatalogFilters) => Promise<{ data: ShopListing[]; total: number }>
  /** Who has each `<contract>-<itemId>` key in their favorites, and since when. */
  getFavoriters: (itemKeys: string[]) => Promise<{ userAddress: string; itemKey: string; favoritedAt: Date }[]>
  publish: (event: Event) => Promise<unknown>
  logger: ILoggerComponent.ILogger
  shopBaseUrl: string
}

export type FavoriteDiscountNotificationsResult = { outcome: 'skipped' } | { outcome: 'ran'; coupons: number; sent: number }

export function itemKey(contractAddress: string, itemId: string): string {
  return `${contractAddress.toLowerCase()}-${itemId}`
}

/**
 * Which candidates to notify for one coupon: one per (user, item) not already notified for it, within each
 * user's remaining daily budget, the most recently favorited items first.
 */
export function selectNotifications(
  candidates: Candidate[],
  alreadySent: Set<string>,
  sentToday: Map<string, number>,
  maxPerDay: number = MAX_NOTIFICATIONS_PER_USER_PER_DAY
): Candidate[] {
  const budget = new Map<string, number>()
  const seen = new Set<string>()
  const selected: Candidate[] = []
  const ordered = [...candidates].sort((a, b) => b.favoritedAt.getTime() - a.favoritedAt.getTime())
  for (const candidate of ordered) {
    const key = `${candidate.userAddress}:${itemKey(candidate.contractAddress, candidate.itemId)}`
    if (seen.has(key) || alreadySent.has(key)) continue
    seen.add(key)
    const left = budget.get(candidate.userAddress) ?? maxPerDay - (sentToday.get(candidate.userAddress) ?? 0)
    if (left <= 0) continue
    budget.set(candidate.userAddress, left - 1)
    selected.push(candidate)
  }
  return selected
}

export function discountPct(discountPpm: number): number {
  return Math.round(discountPpm / 10_000)
}

export function toItemDiscountedEvent(candidate: Candidate, coupon: PendingCoupon, shopBaseUrl: string, now: number): Event {
  const { listing } = candidate
  const pct = discountPct(coupon.discountPpm)
  const name = listing.name || null
  return {
    type: Events.Type.MARKETPLACE,
    subType: ITEM_DISCOUNTED_SUBTYPE,
    key: `item-discounted-${coupon.id}-${itemKey(candidate.contractAddress, candidate.itemId)}-${candidate.userAddress}`,
    timestamp: now,
    metadata: {
      address: candidate.userAddress,
      image: listing.thumbnail,
      category: listing.category,
      rarity: listing.rarity || undefined,
      nftName: name ?? undefined,
      contractAddress: candidate.contractAddress,
      itemId: candidate.itemId,
      link: `${shopBaseUrl.replace(/\/+$/, '')}/item/${candidate.contractAddress}/${candidate.itemId}`,
      discountPct: pct,
      listPrice: String(listing.compareAtCredits),
      salePrice: String(listing.priceCredits),
      endsAt: coupon.expiresAt.getTime(),
      title: 'A favorite is on sale',
      description: name ? `${name} is ${pct}% off.` : `An item you saved is ${pct}% off.`,
      network: listing.network
    }
  } as unknown as Event
}

/** The primary listings this coupon is the discount the catalogue applies to, and that it actually lowers. */
async function discountedListings(
  coupon: PendingCoupon,
  getShopListings: FavoriteDiscountNotificationsDeps['getShopListings']
): Promise<ShopListing[]> {
  const listings = new Map<string, ShopListing>()
  for (const contractAddress of coupon.collections) {
    for (let skip = 0; ; skip += SHOP_MAX_PAGE_SIZE) {
      const page = await getShopListings({
        contractAddress,
        discounted: true,
        listingType: 'primary',
        sortBy: 'discount',
        first: SHOP_MAX_PAGE_SIZE,
        skip
      })
      for (const listing of page.data) {
        if (
          !listings.has(listing.tradeId) &&
          listing.coupon?.id === coupon.id &&
          listing.itemId &&
          listing.compareAtCredits !== null &&
          listing.priceCredits < listing.compareAtCredits
        ) {
          listings.set(listing.tradeId, listing)
        }
      }
      // The total, not the page length: the mapper can drop a row it cannot parse and leave a full page short.
      if (page.data.length === 0 || skip + SHOP_MAX_PAGE_SIZE >= page.total) break
    }
  }
  return [...listings.values()]
}

const CLOSE_UNANNOUNCEABLE = `
  UPDATE marketplace.coupons c SET favorites_notified_at = now()
  WHERE c.favorites_notified_at IS NULL
    AND (
      c.expires_at <= now() + $1 * interval '1 millisecond'
      OR c.effective_since <= now() - $2 * interval '1 millisecond'
      OR c.favorites_attempts >= $3
      OR EXISTS (
        SELECT 1 FROM marketplace.coupon_state s
        WHERE s.coupon_id = c.id AND (s.cancelled OR s.revoked OR s.uses >= (c.checks->>'uses')::numeric)
      )
    )`

// Pushes a coupon that could not be settled back by a doubling delay; CLOSE_UNANNOUNCEABLE gives up on it.
const DEFER = `
  UPDATE marketplace.coupons
  SET favorites_attempts = favorites_attempts + 1,
      favorites_next_attempt_at = now() + $2 * power(2, favorites_attempts) * interval '1 millisecond'
  WHERE id = $1`

const SELECT_PENDING = `
  SELECT c.id, c.discount_ppm, c.collections, c.effective_since, c.expires_at
  FROM marketplace.coupons c
  LEFT JOIN marketplace.coupon_state s ON s.coupon_id = c.id
  WHERE c.favorites_notified_at IS NULL
    AND c.effective_since <= now()
    AND c.expires_at > now() + $1 * interval '1 millisecond'
    AND (c.favorites_next_attempt_at IS NULL OR c.favorites_next_attempt_at <= now())
    AND NOT COALESCE(s.cancelled, false) AND NOT COALESCE(s.revoked, false)
    AND COALESCE(s.uses, 0) < (c.checks->>'uses')::numeric
  ORDER BY c.favorites_attempts ASC, c.discount_ppm DESC, c.effective_since ASC
  LIMIT $2`

/**
 * Tells the people who favorited an item when a creator discount on it starts: in-app only, one notification
 * per item, at most {@link MAX_NOTIFICATIONS_PER_USER_PER_DAY} per user per day. A coupon is announced once,
 * on the first run after it takes effect; one that ends within {@link MIN_TIME_LEFT_MS} is never announced.
 *
 * At most once: the rows are written before the events go out, so a failed publish (or a crash between the two)
 * loses that notification, still counted against the user's day, rather than sending it twice. Items listed
 * after a coupon was announced are not announced.
 */
export async function runFavoriteDiscountNotifications(
  deps: FavoriteDiscountNotificationsDeps
): Promise<FavoriteDiscountNotificationsResult> {
  const { connect, getShopListings, getFavoriters, publish, logger, shopBaseUrl } = deps
  const client = await connect()
  let broken = false
  try {
    const { rows: lock } = await client.query(`SELECT pg_try_advisory_lock(${ADVISORY_LOCK_KEY}) AS acquired`)
    if (!lock[0]?.acquired) return { outcome: 'skipped' }
    try {
      await client.query(CLOSE_UNANNOUNCEABLE, [MIN_TIME_LEFT_MS, MAX_ANNOUNCE_AGE_MS, MAX_ATTEMPTS])
      const { rows } = await client.query(SELECT_PENDING, [MIN_TIME_LEFT_MS, COUPONS_PER_RUN])
      const coupons: PendingCoupon[] = rows.map(row => ({
        id: row.id,
        discountPpm: row.discount_ppm,
        collections: row.collections,
        effectiveSince: new Date(row.effective_since),
        expiresAt: new Date(row.expires_at)
      }))

      let sent = 0
      for (const coupon of coupons) {
        try {
          const listings = await discountedListings(coupon, getShopListings)
          if (listings.length === 0 && Date.now() - coupon.effectiveSince.getTime() < CATALOGUE_GRACE_MS) {
            await client.query(DEFER, [coupon.id, RETRY_BASE_MS])
            continue
          }
          const byKey = new Map(listings.map(listing => [itemKey(listing.contractAddress, listing.itemId as string), listing]))
          const favoriters = byKey.size > 0 ? await getFavoriters([...byKey.keys()]) : []
          const candidates: Candidate[] = []
          for (const { userAddress, itemKey: key, favoritedAt } of favoriters) {
            const listing = byKey.get(key)
            const user = userAddress.toLowerCase()
            if (!listing || user === listing.creator.toLowerCase()) continue
            candidates.push({
              userAddress: user,
              contractAddress: listing.contractAddress.toLowerCase(),
              itemId: listing.itemId as string,
              favoritedAt,
              listing
            })
          }

          let selected: Candidate[] = []
          if (candidates.length > 0) {
            const users = [...new Set(candidates.map(candidate => candidate.userAddress))]
            const today: { user_address: string; sent: number }[] = []
            for (let i = 0; i < users.length; i += ADDRESS_CHUNK) {
              const { rows } = await client.query(
                `SELECT user_address, COUNT(*)::int AS sent FROM marketplace.favorite_discount_notifications
                 WHERE user_address = ANY($1) AND sent_at > now() - interval '24 hours' GROUP BY user_address`,
                [users.slice(i, i + ADDRESS_CHUNK)]
              )
              today.push(...rows)
            }
            const { rows: done } = await client.query(
              'SELECT user_address, contract_address, item_id FROM marketplace.favorite_discount_notifications WHERE coupon_id = $1',
              [coupon.id]
            )
            selected = selectNotifications(
              candidates,
              new Set(done.map(row => `${row.user_address}:${itemKey(row.contract_address, row.item_id)}`)),
              new Map(today.map(row => [row.user_address, row.sent]))
            )
          }

          let inserted: Candidate[] = []
          if (selected.length > 0) {
            const { rows: written } = await client.query(
              `INSERT INTO marketplace.favorite_discount_notifications (user_address, contract_address, item_id, coupon_id)
               SELECT r.user_address, r.contract_address, r.item_id, $2::uuid
               FROM jsonb_to_recordset($1::jsonb) AS r(user_address text, contract_address text, item_id text)
               ON CONFLICT DO NOTHING
               RETURNING user_address, contract_address, item_id`,
              [
                JSON.stringify(
                  selected.map(({ userAddress, contractAddress, itemId }) => ({
                    user_address: userAddress,
                    contract_address: contractAddress,
                    item_id: itemId
                  }))
                ),
                coupon.id
              ]
            )
            const writtenKeys = new Set(written.map(row => `${row.user_address}:${itemKey(row.contract_address, row.item_id)}`))
            inserted = selected.filter(candidate =>
              writtenKeys.has(`${candidate.userAddress}:${itemKey(candidate.contractAddress, candidate.itemId)}`)
            )
          }
          await client.query('UPDATE marketplace.coupons SET favorites_notified_at = now() WHERE id = $1', [coupon.id])

          const now = Date.now()
          for (let i = 0; i < inserted.length; i += PUBLISH_CONCURRENCY) {
            const results = await Promise.allSettled(
              inserted
                .slice(i, i + PUBLISH_CONCURRENCY)
                .map(candidate => publish(toItemDiscountedEvent(candidate, coupon, shopBaseUrl, now)))
            )
            for (const result of results) {
              if (result.status === 'fulfilled') sent += 1
              else logger.warn(`Could not publish a favorite discount notification for coupon ${coupon.id}: ${String(result.reason)}`)
            }
          }
          logger.info(
            `Coupon ${coupon.id}: ${listings.length} discounted items, ${candidates.length} favorites, ${inserted.length} notified`
          )
        } catch (error) {
          // One coupon the catalogue cannot answer for must not hold back the others; it is retried later.
          logger.error(`Could not announce coupon ${coupon.id}: ${error instanceof Error ? error.message : String(error)}`)
          await client.query(DEFER, [coupon.id, RETRY_BASE_MS]).catch(() => undefined)
        }
      }
      return { outcome: 'ran', coupons: coupons.length, sent }
    } finally {
      await client.query(`SELECT pg_advisory_unlock(${ADVISORY_LOCK_KEY})`).catch(() => {
        // A connection that cannot unlock would go back to the pool still holding the lock.
        broken = true
      })
    }
  } finally {
    client.release(broken)
  }
}
