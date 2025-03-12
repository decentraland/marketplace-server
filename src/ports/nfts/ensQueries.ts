import SQL, { SQLStatement } from 'sql-template-strings'
import { NFTCategory } from '@dcl/schemas'
import { MARKETPLACE_SQUID_SCHEMA } from '../../constants'
import { getTradesCTE } from '../catalog/queries'
import { getWhereStatementFromFilters } from '../utils'
import { getNFTsSortBy } from './landQueries'
import { getNFTLimitAndOffsetStatement } from './queries'
import { GetNFTsFilters } from './types'

function geENSWhereStatement(nftFilters: GetNFTsFilters): SQLStatement {
  if (!nftFilters) {
    return SQL``
  }

  const ownerEthereumAddress = nftFilters.owner ? `${nftFilters.owner.toLocaleLowerCase()}-ETHEREUM` : null
  const FILTER_BY_OWNER = nftFilters.owner ? SQL` nft.owner_id = ${ownerEthereumAddress}` : null

  const FILTER_BY_TOKEN_ID = nftFilters.tokenId ? SQL` token_id = ${nftFilters.tokenId} ` : null
  const FILTER_BY_SEARCH = nftFilters.search ? SQL` search_text % ${nftFilters.search} ` : null
  const FILTER_BY_IDS = nftFilters.ids?.length ? SQL` id = ANY (${nftFilters.ids}) ` : null
  const FILTER_NFT_BY_MIN_PRICE = nftFilters.minPrice
    ? SQL` (nft.search_order_price >= ${nftFilters.minPrice} OR trades.amount_received >= ${nftFilters.minPrice})`
    : null
  const FILTER_NFT_BY_MAX_PRICE = nftFilters.maxPrice
    ? SQL` (nft.search_order_price <= ${nftFilters.maxPrice} OR trades.amount_received <= ${nftFilters.maxPrice})`
    : null
  const FILTER_BY_ON_SALE = nftFilters.isOnSale ? SQL` (trades.id IS NOT NULL OR orders.nft_id IS NOT NULL)` : null

  return getWhereStatementFromFilters([
    SQL` nft.category = 'ens' `,
    FILTER_BY_OWNER,
    FILTER_BY_TOKEN_ID,
    FILTER_BY_SEARCH,
    FILTER_BY_IDS,
    FILTER_NFT_BY_MIN_PRICE,
    FILTER_NFT_BY_MAX_PRICE,
    FILTER_BY_ON_SALE
  ])
}

export function getENSs(nftFilters: GetNFTsFilters, uncapped = false): SQLStatement {
  const { sortBy, isOnSale, ids } = nftFilters
  return getTradesCTE({
    cteName: 'trades',
    sortBy: nftFilters.sortBy,
    first: nftFilters.first,
    skip: nftFilters.skip,
    category: NFTCategory.ENS
  })
    .append(
      SQL`
      , filtered_ens_nfts AS (
          SELECT *
          FROM `.append(MARKETPLACE_SQUID_SCHEMA)
    )
    .append(
      SQL`.nft
          WHERE  category = 'ens' `
        .append(ids ? SQL` AND id = ANY(${ids}) ` : SQL``)
        .append(
          SQL`
      )`
            .append(
              isOnSale
                ? SQL`
        , valid_orders AS (
          SELECT
            o.nft_id,
            o.status,
            o.expires_at_normalized
          FROM
            `.append(MARKETPLACE_SQUID_SCHEMA).append(SQL`.order o
          WHERE
            o.status = 'open'
            AND o.expires_at_normalized > now()
        )`)
                : SQL``
            )
            .append(
              SQL`
        SELECT
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
          LEFT JOIN trades ON trades.sent_contract_address = nft.contract_address AND trades.sent_token_id::numeric = nft.token_id AND trades.status = 'open'
          LEFT JOIN `
                .append(MARKETPLACE_SQUID_SCHEMA)
                .append(
                  SQL`.ens ens ON ens.id = nft.ens_id
            `
                    .append(isOnSale ? SQL`LEFT JOIN valid_orders orders ON orders.nft_id = nft.id` : SQL``)
                    .append(geENSWhereStatement(nftFilters))
                    .append(sortBy ? getNFTsSortBy(sortBy) : SQL``)
                    .append(uncapped ? SQL`` : getNFTLimitAndOffsetStatement(nftFilters))
                )
            )
        )
    )
}

export const getENSsCount = (nftFilters: GetNFTsFilters) => {
  const where = geENSWhereStatement({ ...nftFilters, category: NFTCategory.ENS, isOnSale: false })
  const query = nftFilters.isOnSale
    ? SQL`
      SELECT count(*) AS total
      FROM `
        .append(MARKETPLACE_SQUID_SCHEMA)
        .append(
          SQL`.nft nft 
          WHERE 
          nft.category = 'ens'`
            .append(nftFilters.search ? SQL` AND nft.search_text % ${nftFilters.search}` : SQL``)
            .append(nftFilters.tokenId ? SQL` AND nft.token_id = ${nftFilters.tokenId}` : SQL``)
            .append(
              SQL`
          AND (
              EXISTS (
                  SELECT 1
                  FROM marketplace.mv_trades t
                  WHERE t.status = 'open'
                    AND t.sent_nft_category = 'ens'
                    AND t.sent_contract_address = nft.contract_address
                    AND t.sent_token_id::numeric = nft.token_id
                    `
                .append(nftFilters.minPrice ? SQL` AND t.amount_received >= ${nftFilters.minPrice}` : SQL``)
                .append(nftFilters.maxPrice ? SQL` AND t.amount_received <= ${nftFilters.maxPrice}` : SQL``)
                .append(
                  SQL`
              )
              OR 
              EXISTS (
                  SELECT 1
                  FROM `.append(MARKETPLACE_SQUID_SCHEMA).append(SQL`."order" o
                  WHERE o.status = 'open'
                    AND o.expires_at_normalized > now()
                    AND o.nft_id = nft.id
              )
          );
      `)
                )
            )
        )
    : SQL`
    SELECT count(*) AS total
    FROM `
        .append(MARKETPLACE_SQUID_SCHEMA)
        .append(SQL`.nft nft `)
        .append(where)

  return query
}
