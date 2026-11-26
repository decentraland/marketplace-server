export const MARKETPLACE_SQUID_SCHEMA = 'squid_marketplace'
export const REGISTRY_SQUID_SCHEMA = 'squid_registry'
export const BUILDER_SERVER_TABLE_SCHEMA = 'marketplace'

// uint256 max, which the squid writes into `item.price` to mean "no price set" rather than leaving it NULL.
// A `price > 0` guard does NOT exclude it, so a store item carrying the sentinel would be advertised at
// ~1.16e42 credits. Kept as a string because the column is `numeric` and the value exceeds every JS number.
export const NO_PRICE_SENTINEL = '115792089237316195423570985008687907853269984665640564039457584007913129639935'

/**
 * Upper bound on a row's USD-wei price, applied before a credit price is cast to bigint.
 *
 * Without it an absurd price does not merely render badly: `CEIL(usd_wei / C)::bigint` raises
 * `bigint out of range` and the ENTIRE query aborts, so one bad item 500s the feed for every user. The
 * sentinel guard above does not cover this: `sentinel - 1` clears it and still overflows.
 *
 * 1e30 USD wei is $1e12, or 10 trillion credits: orders of magnitude above any real item, and ~1e6 below
 * the bigint ceiling, so the cast has room.
 */
export const MAX_USD_WEI = '1000000000000000000000000000000'
