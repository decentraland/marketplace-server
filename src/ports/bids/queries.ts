import SQL from 'sql-template-strings'
import { BidSortBy } from '@dcl/schemas'
import { GetBidsParameters } from './types'

export function getBidsSortyByQuery(sortBy?: BidSortBy) {
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

export function getBidTradesQuery() {
  return SQL`
    SELECT
      id as trade_id,
      signer as bidder,
      created_at,
      created_at as updated_at,
      expires_at,
      network,
      chain_id,
      assets -> 'sent' ->> 'amount' as price,
      assets -> 'received' ->> 'token_id' as token_id,
      assets -> 'received' ->> 'item_id' as item_id,
      assets -> 'received' ->> 'contract_address' as contract_address,
      assets -> 'received' ->> 'extra' as fingerprint
      FROM (SELECT
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
            'amount', assets_with_values.amount
          )) as assets
          FROM marketplace.trades as t
          JOIN (
            SELECT *
            FROM marketplace.trade_assets as ta 
            LEFT JOIN marketplace.trade_assets_erc721 as erc721 ON ta.id = erc721.asset_id
            LEFT JOIN marketplace.trade_assets_erc20 as erc20 ON ta.id = erc20.asset_id
            LEFT JOIN marketplace.trade_assets_item as item ON ta.id = item.asset_id
          ) as assets_with_values ON t.id = assets_with_values.trade_id
          WHERE t.type = 'bid'
          GROUP BY t.id, t.created_at, t.network, t.chain_id, t.signer, t.checks) as trades`
}

export function getBidsQuery(options: GetBidsParameters) {
  const FROM_BID_TRADES = SQL` FROM (`.append(getBidTradesQuery()).append(SQL`) as bid_trades`)

  const FILTER_BY_BIDDER = options.bidder ? SQL` LOWER(bidder) = LOWER(${options.bidder}) ` : null
  const FILTER_BY_CONTRACT_ADDRESS = options.contractAddress ? SQL` LOWER(contract_address) = LOWER(${options.contractAddress}) ` : null
  const FILTER_BY_TOKEN_ID = options.tokenId ? SQL` LOWER(token_id) = LOWER(${options.tokenId}) ` : null
  const FILTER_BY_ITEM_ID = options.itemId ? SQL` LOWER(item_id) = LOWER(${options.itemId}) ` : null
  const FILTER_BY_NETWORK = options.network ? SQL` network = ${options.network} ` : null

  const FILTERS = [FILTER_BY_BIDDER, FILTER_BY_CONTRACT_ADDRESS, FILTER_BY_TOKEN_ID, FILTER_BY_ITEM_ID, FILTER_BY_NETWORK].reduce(
    (acc, filter) => {
      if (filter === null) {
        return acc
      }

      if (acc === null) {
        return SQL` WHERE `.append(filter)
      }

      return acc.append(SQL` AND `).append(filter)
    },
    null
  )

  return SQL`SELECT *, COUNT(*) OVER() as count`
    .append(FROM_BID_TRADES)
    .append(FILTERS ? FILTERS : SQL``)
    .append(getBidsSortyByQuery(options.sortBy))
    .append(SQL` LIMIT ${options.limit} OFFSET ${options.offset} `)
}