import SQL, { SQLStatement } from 'sql-template-strings'
import { getWhereStatementFromFilters } from '../utils'
import { getNFTsSortBy } from './landQueries'
import { getNFTLimitAndOffsetStatement, getTradesCTE } from './queries'
import { GetNFTsFilters } from './types'

function geENSWhereStatement(nftFilters: GetNFTsFilters): SQLStatement {
  if (!nftFilters) {
    return SQL``
  }

  // Keep only filters that need JOINed tables
  const FILTER_BY_OWNER = nftFilters.owner
    ? SQL` nft.owner_id IN (SELECT id FROM squid_marketplace.account WHERE address = ${nftFilters.owner.toLocaleLowerCase()}) `
    : null
  const FILTER_BY_TOKEN_ID = nftFilters.tokenId ? SQL` token_id = ${nftFilters.tokenId} ` : null
  const FILTER_BY_SEARCH = nftFilters.search ? SQL` search_text % ${nftFilters.search} ` : null
  const FILTER_BY_IDS = nftFilters.ids?.length ? SQL` id = ANY (${nftFilters.ids}) ` : null
  const FILTER_NFT_BY_MIN_PRICE = nftFilters.minPrice ? SQL` nft.search_order_price >= ${nftFilters.minPrice}` : null
  const FILTER_NFT_BY_MAX_PRICE = nftFilters.maxPrice ? SQL` nft.search_order_price <= ${nftFilters.maxPrice}` : null
  const FILTER_BY_ON_SALE = nftFilters.isOnSale ? SQL` (trades.id IS NOT NULL OR orders.nft_id IS NOT NULL)` : null

  return getWhereStatementFromFilters([
    FILTER_BY_OWNER,
    FILTER_BY_TOKEN_ID,
    FILTER_BY_SEARCH,
    FILTER_BY_IDS,
    FILTER_NFT_BY_MIN_PRICE,
    FILTER_NFT_BY_MAX_PRICE,
    FILTER_BY_ON_SALE
  ])
}

export function getENSs(nftFilters: GetNFTsFilters): SQLStatement {
  const { sortBy, isOnSale, ids } = nftFilters
  return SQL`
      WITH filtered_ens_nfts AS (
          SELECT *
          FROM squid_marketplace.nft
          WHERE  category = 'ens' `
    .append(ids ? SQL` AND id = ANY(${ids}) ` : SQL``)
    .append(
      SQL`
          ORDER BY created_at 
      )
        `
        .append(getTradesCTE(nftFilters))
        .append(
          SQL`
        `
        )
        .append(
          isOnSale
            ? SQL`
        , valid_orders AS (
          SELECT
            o.nft_id,
            o.status,
            o.expires_normalized
          FROM
            squid_marketplace.order o
          WHERE
            o.status = 'open'
            AND o.expires_normalized > now()
        )`
            : SQL``
        )
        .append(
          SQL`
        SELECT
          count(*) OVER () AS count,
          nft.id,
          nft.contract_address,
          nft.token_id,
          nft.network,
          nft.created_at,
          nft.token_uri AS url,
          nft.updated_at,
          nft.sold_at,
          nft.urn,
          CASE 
		        WHEN (trades.assets -> 'received' ->> 'amount') IS NOT NULL THEN (trades.assets -> 'received' ->> 'amount')::numeric(78)
		        ELSE nft.search_order_price
		      END AS price,
          nft.owner_id,
          nft.image,
          nft.issued_id,
          nft.category,
          nft.name,
          nft.item_type,
          ens.subdomain AS name,
          ens.subdomain,
          GREATEST(to_timestamp(nft.search_order_created_at), trades.created_at) as order_created_at
          FROM
              filtered_ens_nfts nft
          LEFT JOIN trades ON (trades.assets -> 'sent' ->> 'token_id')::numeric = nft.token_id
            AND trades.assets -> 'sent' ->> 'contract_address' = nft.contract_address
            AND trades.status = 'open'
          LEFT JOIN squid_marketplace.ens ens ON ens.id = nft.ens_id
            `
            .append(isOnSale ? SQL`LEFT JOIN valid_orders orders ON orders.nft_id = nft.id` : SQL``)
            .append(geENSWhereStatement(nftFilters))
            .append(getNFTsSortBy(sortBy))
            .append(getNFTLimitAndOffsetStatement(nftFilters)).append(SQL`;
            `)
        )
    )
}
