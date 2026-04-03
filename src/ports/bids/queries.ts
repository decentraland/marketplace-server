import SQL, { SQLStatement } from 'sql-template-strings'
import { BidSortBy, GetBidsParameters, TradeType } from '@dcl/schemas'
import { MARKETPLACE_SQUID_SCHEMA } from '../../constants'
import { getAddressFilter, getNetworkFilter } from '../filters'
import { getTradesForTypeQuery } from '../trades/queries'
import { getWhereStatementFromFilters } from '../utils'

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
      id as trade_id,
      trade_contract_address,
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
      id as legacy_bid_id,
      '0x' || encode(bidder, 'hex') as bidder,
      '0x' || encode(seller, 'hex') as seller,
      price,
      status,
      to_timestamp(expires_at/1000) AT TIME ZONE 'UTC' as expires_at,
      to_timestamp(created_at) AT TIME ZONE 'UTC' as created_at,
      to_timestamp(updated_at) AT TIME ZONE 'UTC' as updated_at,
      '0x' || encode(fingerprint, 'hex') as fingerprint,
      bid_address,
      blockchain_id,
      block_number,
      network,
      token_id::text,
      nft_address as contract_address
    FROM ${MARKETPLACE_SQUID_SCHEMA}.bid
  `
}

function getBidsFilters(options: GetBidsParameters): SQLStatement {
  const FILTER_BY_BIDDER = options.bidder ? SQL` LOWER(bidder) = LOWER(${options.bidder}) ` : null
  const FILTER_BY_SELLER = options.seller ? SQL` LOWER(seller) = LOWER(${options.seller}) ` : null
  const FILTER_BY_CONTRACT_ADDRESS = getAddressFilter(options.contractAddress, 'contract_address')
  const FILTER_BY_TOKEN_ID = options.tokenId ? SQL` LOWER(token_id) = LOWER(${options.tokenId}) ` : null
  const FILTER_BY_ITEM_ID = options.itemId ? SQL` LOWER(item_id) = LOWER(${options.itemId}) ` : null
  const FILTER_BY_NETWORK = getNetworkFilter(options.network)
  const FILTER_BY_STATUS = options.status ? SQL` status = ${options.status} ` : null
  const FILTER_NOT_EXPIRED = SQL` expires_at > now()::timestamptz(3) `

  return getWhereStatementFromFilters([
    FILTER_BY_BIDDER,
    FILTER_BY_SELLER,
    FILTER_BY_CONTRACT_ADDRESS,
    FILTER_BY_TOKEN_ID,
    FILTER_BY_ITEM_ID,
    FILTER_BY_NETWORK,
    FILTER_BY_STATUS,
    FILTER_NOT_EXPIRED
  ])
}

function getBidsFromClause(): { BID_TRADES: string; LEGACY_BIDS: string } {
  return {
    BID_TRADES: ` (${getBidTradesQuery()}) as bid_trades `,
    LEGACY_BIDS: ` (${getLegacyBidsQuery()}) as legacy_bids`
  }
}

export function getBidsQuery(options: GetBidsParameters) {
  const { BID_TRADES, LEGACY_BIDS } = getBidsFromClause()

  return SQL`SELECT *`
    .append(SQL` FROM `)
    .append(BID_TRADES)
    .append(SQL` NATURAL FULL OUTER JOIN `)
    .append(LEGACY_BIDS)
    .append(getBidsFilters(options))
    .append(getBidsSortByQuery(options.sortBy))
    .append(SQL` LIMIT ${options.limit} OFFSET ${options.offset} `)
}

export function getBidsCountQuery(options: GetBidsParameters) {
  const { BID_TRADES, LEGACY_BIDS } = getBidsFromClause()

  return SQL`SELECT COUNT(*) as count`
    .append(SQL` FROM `)
    .append(BID_TRADES)
    .append(SQL` NATURAL FULL OUTER JOIN `)
    .append(LEGACY_BIDS)
    .append(getBidsFilters(options))
}
