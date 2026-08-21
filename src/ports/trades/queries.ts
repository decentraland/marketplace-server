import { keccak256 } from 'ethers'
import SQL, { SQLStatement } from 'sql-template-strings'
import { TradeAsset, ListingStatus, TradeAssetType, TradeAssetWithBeneficiary, TradeCreation, TradeType, NFTFilters } from '@dcl/schemas'
import { MARKETPLACE_SQUID_SCHEMA } from '../../constants'
import { TRADES_MV_NAME } from '../../logic/trades/materialized-view'

export function getTradeAssetsWithValuesQuery(customWhere?: SQLStatement) {
  // NOTE: select the trade asset's columns EXPLICITLY (never `ta.*`). `marketplace.trades` and
  // `marketplace.trade_assets` both have `id` and `created_at` columns, so `SELECT t.*, ta.*` let
  // `ta.id`/`ta.created_at` clobber `t.id`/`t.created_at` in the result row — making getTrade return
  // the trade with its ASSET's id instead of the trade's own id (the asset mapping never reads either
  // column, so listing only the fields it needs keeps the trade's id/created_at intact).
  return SQL`
    SELECT t.*, ta.direction, ta.asset_type, ta.contract_address, ta.beneficiary, ta.extra, erc721.token_id, erc20.amount, item.item_id
    FROM marketplace.trades as t
    JOIN marketplace.trade_assets as ta ON t.id = ta.trade_id
    LEFT JOIN marketplace.trade_assets_erc721 as erc721 ON ta.id = erc721.asset_id
    LEFT JOIN marketplace.trade_assets_erc20 as erc20 ON ta.id = erc20.asset_id
    LEFT JOIN marketplace.trade_assets_item as item ON ta.id = item.asset_id`.append(customWhere ? SQL` WHERE `.append(customWhere) : SQL``)
}

export function getInsertTradeQuery(trade: TradeCreation & { contract: string; tradeDigest: string | null }, signer: string) {
  return SQL`INSERT INTO marketplace.trades (
    chain_id,
    checks,
    effective_since,
    expires_at,
    network,
    signature,
    hashed_signature,
    trade_digest,
    signer,
    type,
    contract
  ) VALUES (
   ${trade.chainId},
   ${trade.checks},
   ${new Date(trade.checks.effective)},
   ${new Date(trade.checks.expiration)},
   ${trade.network},
   ${trade.signature},
   ${keccak256(trade.signature)},
   ${trade.tradeDigest},
   ${signer.toLowerCase()},
   ${trade.type},
   ${trade.contract}
   ) RETURNING *;`
}

export function getInsertTradeAssetQuery(asset: TradeAsset | TradeAssetWithBeneficiary, tradeId: string, direction: string) {
  return SQL`INSERT INTO marketplace.trade_assets (
    asset_type,
    beneficiary,
    contract_address,
    direction,
    extra,
    trade_id
    ) VALUES (
      ${asset.assetType},
      ${'beneficiary' in asset ? asset.beneficiary.toLowerCase() : null},
      ${asset.contractAddress.toLowerCase()},
      ${direction},
      ${asset.extra},
      ${tradeId}
    ) RETURNING *;`
}

export function getInsertTradeAssetValueByTypeQuery(asset: TradeAsset | TradeAssetWithBeneficiary, assetId: string) {
  switch (asset.assetType) {
    case TradeAssetType.ERC721:
      return SQL`INSERT INTO marketplace.trade_assets_erc721 (
        asset_id,
        token_id
        ) VALUES (
          ${assetId},
          ${asset.tokenId}
        ) RETURNING *;`
    case TradeAssetType.ERC20:
    case TradeAssetType.USD_PEGGED_MANA:
      return SQL`INSERT INTO marketplace.trade_assets_erc20 (
        asset_id,
        amount
        ) VALUES (
          ${assetId},
          ${asset.amount}
        ) RETURNING *;`
    case TradeAssetType.COLLECTION_ITEM:
      return SQL`INSERT INTO marketplace.trade_assets_item (
        asset_id,
        item_id
        ) VALUES (
          ${assetId},
          ${asset.itemId}
        ) RETURNING *;`
    default:
      throw new Error('Invalid asset type')
  }
}

export function getTradeAssetsWithValuesByIdQuery(id: string) {
  return getTradeAssetsWithValuesQuery(SQL`t.id = ${id}`)
}

export function getTradesForTypeQuery(type: TradeType) {
  // Important! This is handled as a string. If input values are later used in this query,
  // they should be sanitized, or the query should be rewritten as an SQLStatement
  return `
    SELECT
      t.id,
      t.contract as trade_contract_address,
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
        'owner', assets_with_values.owner,
        'category', assets_with_values.category,
        'nft_id', assets_with_values.nft_id,
        'issued_id', assets_with_values.issued_id,
        'nft_name', assets_with_values.nft_name
      )) as assets,
      CASE
        WHEN COUNT(CASE WHEN trade_status.action = 'cancelled' THEN 1 END) > 0 THEN '${ListingStatus.CANCELLED}'
        WHEN (
          (signer_signature_index.index IS NOT NULL AND signer_signature_index.index != (t.checks ->> 'signerSignatureIndex')::int)
          OR (signer_signature_index.index IS NULL AND (t.checks ->> 'signerSignatureIndex')::int != 0)
        ) THEN '${ListingStatus.CANCELLED}'
        WHEN (t.expires_at < now()::timestamptz(3)) THEN '${ListingStatus.CANCELLED}'
        WHEN (
          (contract_signature_index.index IS NOT NULL AND contract_signature_index.index != (t.checks ->> 'contractSignatureIndex')::int)
          OR (contract_signature_index.index IS NULL AND (t.checks ->> 'contractSignatureIndex')::int != 0)
        ) THEN '${ListingStatus.CANCELLED}'
        WHEN COUNT(CASE WHEN trade_status.action = 'executed' THEN 1 END) >= (t.checks ->> 'uses')::int then '${ListingStatus.SOLD}'
      ELSE '${ListingStatus.OPEN}'
      END AS status
    FROM marketplace.trades as t
    JOIN (
      SELECT
        ta.trade_id,
        ta.contract_address,
        ta.direction,
        ta.beneficiary,
        ta.extra,
        erc721_asset.token_id,
        coalesce(item_asset.item_id, nft.item_blockchain_id::text) as item_id,
        erc20_asset.amount,
        item.creator,
        nft.owner_address as owner,
        nft.category,
        nft.id as nft_id,
        nft.issued_id as issued_id,
        nft.name as nft_name
      FROM marketplace.trade_assets as ta 
      LEFT JOIN marketplace.trade_assets_erc721 as erc721_asset ON ta.id = erc721_asset.asset_id
      LEFT JOIN marketplace.trade_assets_erc20 as erc20_asset ON ta.id = erc20_asset.asset_id
      LEFT JOIN marketplace.trade_assets_item as item_asset ON ta.id = item_asset.asset_id
      LEFT JOIN ${MARKETPLACE_SQUID_SCHEMA}.item as item ON (ta.contract_address = item.collection_id AND item_asset.item_id::numeric = item.blockchain_id)
      LEFT JOIN ${MARKETPLACE_SQUID_SCHEMA}.nft as nft ON (ta.contract_address = nft.contract_address AND erc721_asset.token_id::numeric = nft.token_id)
    ) as assets_with_values ON t.id = assets_with_values.trade_id
    -- Two identifiers because the marketplace versions key cancellations differently: V1/V2 by
    -- keccak256(signature bytes), V3 by the trade's EIP-712 digest. trade_digest is written on both sides
    -- ONLY for the versions that key on it, so the two columns mean the same thing and NULL never equals
    -- NULL — a V1/V2 trade can only ever match through hashed_signature, a V3 one through the digest.
    LEFT JOIN squid_trades.trade as trade_status
      ON (trade_status.signature = t.hashed_signature OR trade_status.trade_digest = t.trade_digest)
    LEFT JOIN squid_trades.signature_index as signer_signature_index ON LOWER(signer_signature_index.address) = LOWER(t.signer)
    -- Keyed by the trade's OWN marketplace, not just by network: each version keeps an independent
    -- contractSignatureIndex, and a trade signed the value it read from the version it targets.
    LEFT JOIN squid_trades.signature_index as contract_signature_index
      ON LOWER(contract_signature_index.address) = LOWER(t.contract) AND contract_signature_index.network = t.network
    WHERE t.type = '${type}'
    /**
     * NOT grouped by trade_status.caller.
     *
     * A trade has one row in squid_trades.trade per ON-CHAIN ACTION, and their callers differ — a
     * cancellation is called by the signer, an execution by whoever bought (a contract, for a relayed or
     * credits-funded purchase). Grouping by caller therefore split ONE trade into one group per caller,
     * and the status CASE was then evaluated per group: the group holding the cancellation counted it and
     * returned cancelled, while the group holding the execution counted no cancellation and fell through
     * to open.
     *
     * That produced two contradictory rows for the same trade, and getOpenItemOrderQuery does
     * WHERE status = 'open' LIMIT 1 — so any item whose order had been BOTH executed at least once and
     * then cancelled became permanently unlistable, rejected with "There is already an open order for this
     * Item". Both the Shop catalogue and the Builder correctly showed the item as not for sale, because
     * getTradesForTypeQueryWithFilters (below) never grouped by caller, so nothing surfaced the phantom
     * listing that was doing the blocking.
     *
     * caller was in the GROUP BY only because the CASE above referenced it; removing that reference is
     * what allows this to group by the trade, which is the unit a status describes. It now matches the
     * filtered query verbatim.
     */
    GROUP BY t.id, t.created_at, t.network, t.chain_id, t.signer, t.checks, contract_signature_index.index, signer_signature_index.index
  `
}

export function getOpenItemOrderQuery(contractAddress: string, itemId: string, network: string): SQLStatement {
  return SQL`SELECT 1 FROM (`
    .append(getTradesForTypeQuery(TradeType.PUBLIC_ITEM_ORDER))
    .append(SQL`) AS item_order_trades WHERE item_order_trades.status = ${ListingStatus.OPEN}`)
    .append(SQL` AND item_order_trades.network = ${network}`)
    .append(SQL` AND (item_order_trades.assets -> 'sent' ->> 'contract_address') = ${contractAddress}`)
    .append(SQL` AND (item_order_trades.assets -> 'sent' ->> 'item_id') = ${itemId}`)
    .append(SQL` LIMIT 1`)
}

export function getOpenNFTOrderQuery(contractAddress: string, tokenId: string, network: string): SQLStatement {
  return SQL`SELECT 1 FROM (`
    .append(getTradesForTypeQuery(TradeType.PUBLIC_NFT_ORDER))
    .append(SQL`) AS nft_order_trades WHERE nft_order_trades.status = ${ListingStatus.OPEN}`)
    .append(SQL` AND nft_order_trades.network = ${network}`)
    .append(SQL` AND (nft_order_trades.assets -> 'sent' ->> 'contract_address') = ${contractAddress}`)
    .append(SQL` AND (nft_order_trades.assets -> 'sent' ->> 'token_id') = ${tokenId}`)
    .append(SQL` LIMIT 1`)
}

export function getTradesForTypeQueryWithFilters(type: TradeType, filters: NFTFilters & { nftIds?: string[] }) {
  return SQL`
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
        'owner', assets_with_values.owner,
        'category', assets_with_values.category,
        'nft_id', assets_with_values.nft_id,
        'issued_id', assets_with_values.issued_id,
        'nft_name', assets_with_values.nft_name
      )) as assets,
      CASE
        WHEN COUNT(CASE WHEN trade_status.action = 'cancelled' THEN 1 END) > 0 THEN 'cancelled'
        WHEN (
          (signer_signature_index.index IS NOT NULL AND signer_signature_index.index != (t.checks ->> 'signerSignatureIndex')::int)
          OR (signer_signature_index.index IS NULL AND (t.checks ->> 'signerSignatureIndex')::int != 0)
        ) THEN 'cancelled'
        WHEN (t.expires_at < now()::timestamptz(3)) THEN 'cancelled'
        WHEN (
          (contract_signature_index.index IS NOT NULL AND contract_signature_index.index != (t.checks ->> 'contractSignatureIndex')::int)
          OR (contract_signature_index.index IS NULL AND (t.checks ->> 'contractSignatureIndex')::int != 0)
        ) THEN 'cancelled'
        WHEN COUNT(CASE WHEN trade_status.action = 'executed' THEN 1 END) >= (t.checks ->> 'uses')::int then 'sold'
      ELSE 'open'
      END AS status
    FROM marketplace.trades as t
    JOIN (
      SELECT
        ta.trade_id,
        ta.contract_address,
        ta.direction,
        ta.beneficiary,
        ta.extra,
        erc721_asset.token_id,
        coalesce(item_asset.item_id, nft.item_blockchain_id::text) as item_id,
        erc20_asset.amount,
        item.creator,
        nft.owner_address as owner,
        nft.category,
        nft.id as nft_id,
        nft.issued_id as issued_id,
        nft.name as nft_name
      FROM marketplace.trade_assets as ta 
      LEFT JOIN marketplace.trade_assets_erc721 as erc721_asset ON ta.id = erc721_asset.asset_id
      LEFT JOIN marketplace.trade_assets_erc20 as erc20_asset ON ta.id = erc20_asset.asset_id
      LEFT JOIN marketplace.trade_assets_item as item_asset ON ta.id = item_asset.asset_id
      LEFT JOIN `
    .append(MARKETPLACE_SQUID_SCHEMA)
    .append(
      SQL`.item as item ON (ta.contract_address = item.collection_id AND item_asset.item_id::numeric = item.blockchain_id)
      LEFT JOIN `
        .append(MARKETPLACE_SQUID_SCHEMA)
        .append(
          SQL`.nft as nft ON (ta.contract_address = nft.contract_address AND erc721_asset.token_id::numeric = nft.token_id) `
            .append(filters.nftIds ? SQL` AND nft.id = ANY(${filters.nftIds})` : SQL``)
            .append(
              SQL`
    ) as assets_with_values ON t.id = assets_with_values.trade_id
    -- Two identifiers because the marketplace versions key cancellations differently: V1/V2 by
    -- keccak256(signature bytes), V3 by the trade's EIP-712 digest. trade_digest is written on both sides
    -- ONLY for the versions that key on it, so the two columns mean the same thing and NULL never equals
    -- NULL — a V1/V2 trade can only ever match through hashed_signature, a V3 one through the digest.
    LEFT JOIN squid_trades.trade as trade_status
      ON (trade_status.signature = t.hashed_signature OR trade_status.trade_digest = t.trade_digest)
    LEFT JOIN squid_trades.signature_index as signer_signature_index ON LOWER(signer_signature_index.address) = LOWER(t.signer)
    -- Keyed by the trade's OWN marketplace, not just by network: each version keeps an independent
    -- contractSignatureIndex, and a trade signed the value it read from the version it targets.
    LEFT JOIN squid_trades.signature_index as contract_signature_index
      ON LOWER(contract_signature_index.address) = LOWER(t.contract) AND contract_signature_index.network = t.network
    WHERE t.type = '`
                .append(type)
                .append(
                  SQL`'`.append(filters.owner ? SQL` AND t.signer = ${filters.owner.toLowerCase()}` : SQL``).append(SQL`
    GROUP BY t.id, t.created_at, t.network, t.chain_id, t.signer, t.checks, contract_signature_index.index, signer_signature_index.index
  `)
                )
            )
        )
    )
}

export function getTradeAssetsWithValuesByHashedSignatureQuery(hashedSignature: string) {
  return getTradeAssetsWithValuesQuery(SQL`t.hashed_signature = ${hashedSignature}`)
}

// Returns flat (trade × asset) rows with explicit aliases so the join's overlapping
// `id` and `trade_id` columns can be disambiguated when grouping by trade in JS.
export function getTradesByAddressQuery(address: string, options: { limit: number; offset?: number }) {
  const lowered = address.toLowerCase()
  const offset = options.offset ?? 0
  return SQL`
    SELECT
      t.id           AS trade_id,
      t.chain_id     AS trade_chain_id,
      t.checks       AS trade_checks,
      t.created_at   AS trade_created_at,
      t.effective_since AS trade_effective_since,
      t.expires_at   AS trade_expires_at,
      t.network      AS trade_network,
      t.signature    AS trade_signature,
      t.signer       AS trade_signer,
      t.type         AS trade_type,
      t.contract     AS trade_contract,
      ta.id              AS asset_id,
      ta.asset_type      AS asset_type,
      ta.beneficiary     AS asset_beneficiary,
      ta.contract_address AS asset_contract_address,
      ta.direction       AS asset_direction,
      ta.extra           AS asset_extra,
      ta.trade_id        AS asset_trade_id,
      ta.created_at      AS asset_created_at,
      erc721.token_id    AS token_id,
      erc20.amount       AS amount,
      item.item_id       AS item_id
    FROM marketplace.trades AS t
    JOIN marketplace.trade_assets AS ta ON t.id = ta.trade_id
    LEFT JOIN marketplace.trade_assets_erc721 AS erc721 ON ta.id = erc721.asset_id
    LEFT JOIN marketplace.trade_assets_erc20 AS erc20 ON ta.id = erc20.asset_id
    LEFT JOIN marketplace.trade_assets_item AS item ON ta.id = item.asset_id
    WHERE t.id IN (
      SELECT t2.id FROM marketplace.trades AS t2
      WHERE t2.signer = ${lowered}
         OR EXISTS (
           SELECT 1 FROM marketplace.trade_assets AS ta2
           WHERE ta2.trade_id = t2.id AND ta2.beneficiary = ${lowered}
         )
      ORDER BY t2.created_at DESC
      LIMIT ${options.limit}
      OFFSET ${offset}
    )
    ORDER BY t.created_at DESC, ta.direction ASC`
}

// Resolves the item id of an ERC721 (secondary listing) asset. Uses the same join the trade queries and
// the trades materialized view rely on: the squid `nft` table keyed by contract_address + token_id, from
// which `item_blockchain_id` is the item id the NFT was minted from.
export function getItemIdByTokenIdQuery(contractAddress: string, tokenId: string): SQLStatement {
  return SQL`SELECT nft.item_blockchain_id::text AS item_id FROM `
    .append(MARKETPLACE_SQUID_SCHEMA)
    .append(SQL`.nft AS nft WHERE nft.contract_address = ${contractAddress.toLowerCase()} AND nft.token_id = ${tokenId}::numeric LIMIT 1`)
}

// Transition check for the "item went on sale" waitlist ping. Returns a row when the item already has
// ANOTHER open listing (item or nft order) besides the just-created trade, meaning it was already on
// sale and no ping is warranted. Reads the trades materialized view, which can be up to
// TRADES_MV_REFRESH_INTERVAL_SECONDS (~30s) stale; the worst case is a duplicate ping, which the Shop
// dedupes, so a slightly stale read is acceptable here.
export function getOtherOpenListingForItemQuery(contractAddress: string, itemId: string, excludeTradeId: string): SQLStatement {
  return SQL`SELECT 1 FROM marketplace.`.append(TRADES_MV_NAME).append(
    SQL` WHERE status = 'open'
      AND type IN ('public_item_order', 'public_nft_order')
      AND sent_contract_address = ${contractAddress.toLowerCase()}
      AND sent_item_id = ${itemId}
      AND id <> ${excludeTradeId}
      LIMIT 1`
  )
}
