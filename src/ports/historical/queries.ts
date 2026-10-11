import SQL, { SQLStatement } from 'sql-template-strings'
import { MARKETPLACE_SQUID_SCHEMA, REGISTRY_SQUID_SCHEMA } from '../../constants'

export type NftTarget = {
  category?: string
  contractAddresses?: string[]
  itemTypes?: string[]
}

/**
 * The owner, at `block`, of every Ethereum NFT the target describes: the receiver of its last
 * transfer up to that block. The squid keeps one transfer per NFT and block (the last one), and a
 * transfer's `nft_id` is `<category>-<contractAddress>-<tokenId>`. NFTs minted after the block have no
 * transfer yet and are left out.
 */
export function getOwnersAtBlockQuery(block: number, target: NftTarget): SQLStatement {
  const query = SQL`
    WITH target AS (
      SELECT category, contract_address, token_id::text AS token_id, item_type, search_wearable_rarity,
        category || '-' || contract_address || '-' || token_id AS transfer_nft_id
      FROM `
    .append(MARKETPLACE_SQUID_SCHEMA)
    .append(
      SQL`.nft
      WHERE network = 'ETHEREUM'`
    )
  if (target.category) query.append(SQL` AND category = ${target.category}`)
  if (target.contractAddresses?.length) query.append(SQL` AND contract_address = ANY(${target.contractAddresses})`)
  if (target.itemTypes?.length) query.append(SQL` AND item_type = ANY(${target.itemTypes})`)
  query
    .append(
      SQL`
    ), latest AS (
      SELECT DISTINCT ON (t.nft_id) t.nft_id, t."to" AS owner
      FROM `
    )
    .append(MARKETPLACE_SQUID_SCHEMA)
    .append(
      SQL`.transfer t JOIN target ON target.transfer_nft_id = t.nft_id
      WHERE t.network = 'ETHEREUM' AND t.block <= ${block}
      ORDER BY t.nft_id, t.block DESC
    )
    SELECT target.contract_address, target.token_id, target.category, target.item_type, target.search_wearable_rarity, latest.owner
    FROM latest JOIN target ON target.transfer_nft_id = latest.nft_id`
    )
  return query
}

/** Every estate's size at `block`: the parcels added to it up to then, minus those removed. */
export function getEstateSizesAtBlockQuery(block: number): SQLStatement {
  return SQL`
    SELECT estate_token_id, SUM(CASE event_name WHEN 'AddLand' THEN 1 WHEN 'RemoveLand' THEN -1 ELSE 0 END)::int AS size
    FROM `
    .append(REGISTRY_SQUID_SCHEMA)
    .append(
      SQL`.estate_history
    WHERE block_number <= ${block}
    GROUP BY estate_token_id`
    )
}

/**
 * The last rental, up to `block`, of every asset ever put in the Rentals contract. A claim marks the
 * asset's latest rental, so whether that rental was claimed by the block says whether the asset was.
 */
export function getRentalsAtBlockQuery(block: number): SQLStatement {
  return SQL`
    SELECT DISTINCT ON (contract_address, token_id) contract_address, token_id::text AS token_id, lessor, claimed_at::text AS claimed_at
    FROM `
    .append(REGISTRY_SQUID_SCHEMA)
    .append(
      SQL`.rental
    WHERE block_number <= ${block}
    ORDER BY contract_address, token_id, block_number DESC, log_index DESC`
    )
}

/** The schema of a squid's live deployment, which the squid management server keeps in `public.squids`. */
export function getLiveSchemaQuery(squid: string): SQLStatement {
  return SQL`SELECT schema FROM public.squids WHERE name = ${squid}`
}

/**
 * How far a squid's processor has indexed: its highest hot block, or its finalized height when it holds
 * none. The state schema is a name read from `public.squids`, so it is checked before it goes in.
 */
export function getIndexedHeightQuery(stateSchema: string): SQLStatement {
  if (!/^[a-z0-9_]{1,63}$/.test(stateSchema)) {
    throw new Error(`Unexpected state schema name: ${stateSchema}`)
  }
  return SQL`SELECT GREATEST((SELECT height FROM `
    .append(`"${stateSchema}"`)
    .append(SQL`.status WHERE id = 0), (SELECT max(height) FROM `)
    .append(`"${stateSchema}"`)
    .append(SQL`.hot_block)) AS height`)
}
