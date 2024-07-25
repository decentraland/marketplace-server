import SQL from 'sql-template-strings'
import { BidSortBy } from '@dcl/schemas'
import { getDBNetworks } from '../../utils'
import { GetBidsParameters } from './types'

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
	    COALESCE(assets -> 'received' ->> 'creator', assets -> 'received' ->> 'owner') as seller
    FROM (
      SELECT
        t.id,
        t.created_at,
        t.signer,
        t.expires_at,
        t.checks,
        t.network,
        t.chain_id,
        COUNT(*) OVER() as count,
        json_object_agg(assets_with_values.direction, json_build_object(
          'contract_address', assets_with_values.contract_address,
          'direction', assets_with_values.direction,
          'beneficiary', assets_with_values.beneficiary,
          'extra', assets_with_values.extra,
          'token_id', assets_with_values.token_id, 
          'item_id', assets_with_values.item_id,
          'amount', assets_with_values.amount,
          'creator', assets_with_values.creator,
          'owner', assets_with_values.owner_id
        )) as assets
      FROM marketplace.trades as t
      JOIN (
        SELECT
          ta.trade_id,
          ta.contract_address,
          ta.direction,
          ta.beneficiary,
          ta.extra,
          erc721_asset.token_id,
          item_asset.item_id,
          erc20_asset.amount,
          item.creator,
          nft.owner_id
        FROM marketplace.trade_assets as ta 
        LEFT JOIN marketplace.trade_assets_erc721 as erc721_asset ON ta.id = erc721_asset.asset_id
        LEFT JOIN marketplace.trade_assets_erc20 as erc20_asset ON ta.id = erc20_asset.asset_id
        LEFT JOIN marketplace.trade_assets_item as item_asset ON ta.id = item_asset.asset_id
        LEFT JOIN squid_marketplace.item as item ON (ta.contract_address = item.collection_id AND item_asset.item_id = item.blockchain_id::text)
        LEFT JOIN squid_marketplace.nft as nft ON (ta.contract_address = nft.contract_address AND erc721_asset.token_id = nft.token_id::text)
      ) as assets_with_values ON t.id = assets_with_values.trade_id
      WHERE t.type = 'bid'
      GROUP BY t.id, t.created_at, t.network, t.chain_id, t.signer, t.checks
    ) as trades`
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
    FROM squid_marketplace.bid
  `
}

export function getBidsQuery(options: GetBidsParameters) {
  const BID_TRADES = ` (${getBidTradesQuery()}) as bid_trades `
  const LEGACY_BIDS = ` (${getLegacyBidsQuery()}) as legacy_bids`

  const FILTER_BY_BIDDER = options.bidder ? SQL` LOWER(bidder) = LOWER(${options.bidder}) ` : null
  const FILTER_BY_SELLER = options.seller ? SQL` LOWER(seller) = LOWER(${options.seller}) ` : null
  const FILTER_BY_CONTRACT_ADDRESS = options.contractAddress ? SQL` LOWER(contract_address) = LOWER(${options.contractAddress}) ` : null
  const FILTER_BY_TOKEN_ID = options.tokenId ? SQL` LOWER(token_id) = LOWER(${options.tokenId}) ` : null
  const FILTER_BY_ITEM_ID = options.itemId ? SQL` LOWER(item_id) = LOWER(${options.itemId}) ` : null
  const FILTER_BY_NETWORK = options.network ? SQL` network = ANY (${getDBNetworks(options.network)}) ` : null

  const FILTERS = [
    FILTER_BY_BIDDER,
    FILTER_BY_SELLER,
    FILTER_BY_CONTRACT_ADDRESS,
    FILTER_BY_TOKEN_ID,
    FILTER_BY_ITEM_ID,
    FILTER_BY_NETWORK
  ].reduce((acc, filter) => {
    if (filter === null) {
      return acc
    }

    if (acc === null) {
      return SQL` WHERE `.append(filter)
    }

    return acc.append(SQL` AND `).append(filter)
  }, null)

  return SQL`SELECT *, COUNT(*) OVER() as count`
    .append(SQL` FROM `)
    .append(BID_TRADES)
    .append(SQL` NATURAL FULL OUTER JOIN `)
    .append(LEGACY_BIDS)
    .append(FILTERS ? FILTERS : SQL``)
    .append(getBidsSortByQuery(options.sortBy))
    .append(SQL` LIMIT ${options.limit} OFFSET ${options.offset} `)
}
