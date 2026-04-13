import SQL from 'sql-template-strings'
import { BidSortBy, GetBidsParameters, TradeType } from '@dcl/schemas'
import { MARKETPLACE_SQUID_SCHEMA } from '../../constants'
import { getDBNetworks } from '../../utils'
import { getTradesForTypeQuery } from '../trades/queries'
import { getWhereStatementFromFilters } from '../utils'

/**
 * Canonical column order for both bid subqueries.
 * getBidTradesQuery() and getLegacyBidsQuery() MUST SELECT these columns in this exact order.
 */
export const BID_COLUMNS = [
  'trade_id',
  'legacy_bid_id',
  'trade_contract_address',
  'bid_address',
  'blockchain_id',
  'block_number',
  'bidder',
  'created_at',
  'updated_at',
  'expires_at',
  'network',
  'chain_id',
  'price',
  'token_id',
  'item_id',
  'contract_address',
  'fingerprint',
  'seller',
  'status'
] as const

export function getBidsSortByQuery(sortBy?: BidSortBy) {
  switch (sortBy) {
    case BidSortBy.RECENTLY_OFFERED:
      return SQL` ORDER BY created_at DESC `
    case BidSortBy.RECENTLY_UPDATED:
      return SQL` ORDER BY updated_at DESC `
    case BidSortBy.MOST_EXPENSIVE:
      return SQL` ORDER BY price DESC `
    default:
      return SQL` ORDER BY created_at DESC `
  }
}

export function getBidTradesQuery(): string {
  // Important! This is handled as a string. If input values are later used in this query,
  // they should be sanitized, or the query should be rewritten as an SQLStatement
  return `
    SELECT
      id::text as trade_id,
      NULL::text as legacy_bid_id,
      trade_contract_address,
      NULL::text as bid_address,
      NULL::text as blockchain_id,
      NULL::bigint as block_number,
      signer as bidder,
      created_at,
      created_at as updated_at,
      expires_at,
      network,
      chain_id,
      (assets -> 'sent' ->> 'amount')::numeric(78) as price,
      assets -> 'received' ->> 'token_id' as token_id,
      assets -> 'received' ->> 'item_id' as item_id,
      assets -> 'received' ->> 'contract_address' as contract_address,
      assets -> 'received' ->> 'extra' as fingerprint,
	    COALESCE(assets -> 'received' ->> 'creator', assets -> 'received' ->> 'owner') as seller,
      status
    FROM (${getTradesForTypeQuery(TradeType.BID)}) as trades`
}

export function getLegacyBidsQuery(): string {
  // Important! This is handled as a string. If input values are later used in this query,
  // they should be sanitized, or the query should be rewritten as an SQLStatement
  return `
    SELECT
      NULL::text as trade_id,
      id as legacy_bid_id,
      NULL::text as trade_contract_address,
      bid_address,
      blockchain_id,
      block_number,
      '0x' || encode(bidder, 'hex') as bidder,
      to_timestamp(created_at) AT TIME ZONE 'UTC' as created_at,
      to_timestamp(updated_at) AT TIME ZONE 'UTC' as updated_at,
      to_timestamp(expires_at/1000) AT TIME ZONE 'UTC' as expires_at,
      network,
      NULL::int as chain_id,
      price,
      token_id::text,
      NULL::text as item_id,
      nft_address as contract_address,
      '0x' || encode(fingerprint, 'hex') as fingerprint,
      '0x' || encode(seller, 'hex') as seller,
      status
    FROM ${MARKETPLACE_SQUID_SCHEMA}.bid
  `
}

function getBidsAndTradesFilters(options: GetBidsParameters) {
  const FILTER_BY_BIDDER = options.bidder ? SQL` LOWER(bidder) = LOWER(${options.bidder}) ` : null
  const FILTER_BY_SELLER = options.seller ? SQL` LOWER(seller) = LOWER(${options.seller}) ` : null
  const FILTER_BY_CONTRACT_ADDRESS = options.contractAddress ? SQL` contract_address = ${options.contractAddress.toLowerCase()} ` : null
  const FILTER_BY_TOKEN_ID = options.tokenId ? SQL` LOWER(token_id) = LOWER(${options.tokenId}) ` : null
  const FILTER_BY_NETWORK = options.network ? SQL` network = ANY (${getDBNetworks(options.network)}) ` : null
  const FILTER_BY_STATUS = options.status ? SQL` status = ${options.status} ` : null
  const FILTER_NOT_EXPIRED = SQL` expires_at > now()::timestamptz(3) `

  // Note: these SQLStatement instances are shared by reference between the trades and legacy arrays.
  // This is safe because getWhereStatementFromFilters only appends them onto a separate accumulator
  // and never mutates the filter objects themselves.
  const COMMON_FILTERS = [
    FILTER_BY_BIDDER,
    FILTER_BY_SELLER,
    FILTER_BY_CONTRACT_ADDRESS,
    FILTER_BY_TOKEN_ID,
    FILTER_BY_NETWORK,
    FILTER_BY_STATUS,
    FILTER_NOT_EXPIRED
  ]

  const FILTER_TRADE_BY_ITEM_ID = options.itemId ? SQL` LOWER(item_id) = LOWER(${options.itemId}) ` : null
  // Legacy bids don't have item_id, so if filtering by item_id, exclude all legacy bids
  const FILTER_LEGACY_BY_ITEM_ID = options.itemId ? SQL` FALSE ` : null

  return {
    trades: [...COMMON_FILTERS, FILTER_TRADE_BY_ITEM_ID],
    legacy: [...COMMON_FILTERS, FILTER_LEGACY_BY_ITEM_ID]
  }
}

export function getBidsQuery(options: GetBidsParameters) {
  const { trades: tradesFilters, legacy: legacyFilters } = getBidsAndTradesFilters(options)

  const bidTradesQuery = SQL`SELECT * FROM (`
    .append(getBidTradesQuery())
    .append(SQL`) as bid_trades`)
    .append(getWhereStatementFromFilters(tradesFilters))

  const legacyBidsQuery = SQL`SELECT * FROM (`
    .append(getLegacyBidsQuery())
    .append(SQL`) as legacy_bids`)
    .append(getWhereStatementFromFilters(legacyFilters))

  // Note: inner LIMIT pushdown per branch (like orders use) is intentionally omitted here
  // because COUNT(*) OVER() needs the full UNION ALL result to report accurate totals.
  // If bid volumes grow significantly, consider a separate count query (see getOrdersCountQuery).
  return SQL`SELECT *, COUNT(*) OVER() as bids_count FROM (`
    .append(SQL`(`)
    .append(bidTradesQuery)
    .append(SQL`) UNION ALL (`)
    .append(legacyBidsQuery)
    .append(SQL`)) as combined_bids`)
    .append(getBidsSortByQuery(options.sortBy))
    .append(SQL` LIMIT ${options.limit} OFFSET ${options.offset} `)
}
