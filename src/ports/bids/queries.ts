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
      assets -> 'received' ->> 'tokenId' as tokenId,
      assets -> 'received' ->> 'itemId' as itemId,
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
            'tokenId', assets_with_values.token_id, 
            'itemId', assets_with_values.item_id,
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
  const WHERE_BIDDER = options.bidder ? SQL` WHERE bidder = ${options.bidder}` : SQL``
  return SQL`SELECT *, COUNT(*) OVER() as count`
    .append(FROM_BID_TRADES)
    .append(WHERE_BIDDER)
    .append(getBidsSortyByQuery(options.sortBy))
    .append(SQL` LIMIT ${options.limit} OFFSET ${options.offset} `)
}
