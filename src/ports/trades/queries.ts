import { keccak256 } from 'ethers'
import SQL, { SQLStatement } from 'sql-template-strings'
import { TradeAsset, ListingStatus, TradeAssetType, TradeAssetWithBeneficiary, TradeCreation, TradeType, NFTFilters } from '@dcl/schemas'
import { ContractName, getContract } from 'decentraland-transactions'
import { getEthereumChainId, getPolygonChainId } from '../../logic/chainIds'

export function getTradeAssetsWithValuesQuery(customWhere?: SQLStatement) {
  return SQL`
    SELECT t.*, ta.*, erc721.token_id, erc20.amount, item.item_id
    FROM marketplace.trades as t
    JOIN marketplace.trade_assets as ta ON t.id = ta.trade_id
    LEFT JOIN marketplace.trade_assets_erc721 as erc721 ON ta.id = erc721.asset_id
    LEFT JOIN marketplace.trade_assets_erc20 as erc20 ON ta.id = erc20.asset_id
    LEFT JOIN marketplace.trade_assets_item as item ON ta.id = item.asset_id`.append(customWhere ? SQL` WHERE `.append(customWhere) : SQL``)
}

export function getInsertTradeQuery(trade: TradeCreation, signer: string) {
  return SQL`INSERT INTO marketplace.trades (
    chain_id,
    checks,
    effective_since,
    expires_at,
    network,
    signature,
    hashed_signature,
    signer,
    type
  ) VALUES (
   ${trade.chainId},
   ${trade.checks},
   ${new Date(trade.checks.effective)},
   ${new Date(trade.checks.expiration)},
   ${trade.network},
   ${trade.signature},
   ${keccak256(trade.signature)},
   ${signer.toLowerCase()},
   ${trade.type}
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
  const marketplacePolygon = getContract(ContractName.OffChainMarketplace, getPolygonChainId())
  const marketplaceEthereum = getContract(ContractName.OffChainMarketplace, getEthereumChainId())
  // Important! This is handled as a string. If input values are later used in this query,
  // they should be sanitized, or the query should be rewritten as an SQLStatement
  return `
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
        account.address as owner,
        nft.category,
        nft.id as nft_id,
        nft.issued_id as issued_id,
        nft.name as nft_name
      FROM marketplace.trade_assets as ta 
      LEFT JOIN marketplace.trade_assets_erc721 as erc721_asset ON ta.id = erc721_asset.asset_id
      LEFT JOIN marketplace.trade_assets_erc20 as erc20_asset ON ta.id = erc20_asset.asset_id
      LEFT JOIN marketplace.trade_assets_item as item_asset ON ta.id = item_asset.asset_id
      LEFT JOIN squid_marketplace.item as item ON (ta.contract_address = item.collection_id AND item_asset.item_id = item.blockchain_id::text)
      LEFT JOIN squid_marketplace.nft as nft ON (ta.contract_address = nft.contract_address AND erc721_asset.token_id = nft.token_id::text)
      LEFT JOIN squid_marketplace.account as account ON (account.id = nft.owner_id)
    ) as assets_with_values ON t.id = assets_with_values.trade_id
    LEFT JOIN squid_trades.trade as trade_status ON trade_status.signature = t.hashed_signature
    LEFT JOIN squid_trades.signature_index as signer_signature_index ON LOWER(signer_signature_index.address) = LOWER(t.signer)
    LEFT JOIN (select * from squid_trades.signature_index signature_index where LOWER(signature_index.address) IN ('${marketplaceEthereum.address.toLowerCase()}','${marketplacePolygon.address.toLowerCase()}')) as contract_signature_index ON t.network = contract_signature_index.network
    WHERE t.type = '${type} '
    GROUP BY t.id, t.created_at, t.network, t.chain_id, t.signer, t.checks, contract_signature_index.index, signer_signature_index.index
  `
}

export function getTradesForTypeQueryWithFilters(type: TradeType, filters: NFTFilters) {
  const marketplacePolygon = getContract(ContractName.OffChainMarketplace, getPolygonChainId())
  const marketplaceEthereum = getContract(ContractName.OffChainMarketplace, getEthereumChainId())
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
        account.address as owner,
        nft.category,
        nft.id as nft_id,
        nft.issued_id as issued_id,
        nft.name as nft_name
      FROM marketplace.trade_assets as ta 
      LEFT JOIN marketplace.trade_assets_erc721 as erc721_asset ON ta.id = erc721_asset.asset_id
      LEFT JOIN marketplace.trade_assets_erc20 as erc20_asset ON ta.id = erc20_asset.asset_id
      LEFT JOIN marketplace.trade_assets_item as item_asset ON ta.id = item_asset.asset_id
      LEFT JOIN squid_marketplace.item as item ON (ta.contract_address = item.collection_id AND item_asset.item_id = item.blockchain_id::text)
      LEFT JOIN squid_marketplace.nft as nft ON (ta.contract_address = nft.contract_address AND erc721_asset.token_id = nft.token_id::text)
      LEFT JOIN squid_marketplace.account as account ON (account.id = nft.owner_id)
    ) as assets_with_values ON t.id = assets_with_values.trade_id
    LEFT JOIN squid_trades.trade as trade_status ON trade_status.signature = t.hashed_signature
    LEFT JOIN squid_trades.signature_index as signer_signature_index ON LOWER(signer_signature_index.address) = LOWER(t.signer)
    LEFT JOIN (select * from squid_trades.signature_index signature_index where LOWER(signature_index.address) IN ('`
    .append(marketplaceEthereum.address.toLowerCase())
    .append(SQL`'`)
    .append(
      SQL`,'`.append(marketplacePolygon.address.toLowerCase()).append(
        SQL`')) as contract_signature_index ON t.network = contract_signature_index.network
    WHERE t.type = '`
          .append(type)
          .append(
            SQL`'`.append(filters.owner ? SQL` AND t.signer = ${filters.owner.toLowerCase()}` : SQL``).append(SQL`
    GROUP BY t.id, t.created_at, t.network, t.chain_id, t.signer, t.checks, contract_signature_index.index, signer_signature_index.index
  `)
          )
      )
    )
}

export function getTradeAssetsWithValuesByHashedSignatureQuery(hashedSignature: string) {
  return getTradeAssetsWithValuesQuery(SQL`t.hashed_signature = ${hashedSignature}`)
}
