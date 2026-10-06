import SQL, { SQLStatement } from 'sql-template-strings'
import { MARKETPLACE_SQUID_SCHEMA } from '../../constants'
import { squidTradesNetwork } from '../../logic/trades/squid'
import { ITEM_NAME_EXPRESSION } from '../items/queries'
import { getTradeAssetsWithValuesQuery } from '../trades/queries'
import { CancelledTradesFilters } from './types'

// Listings send the asset and receive the price; bids the other way around.
const ASSET_SIDE = (alias: string) => `CASE WHEN ${alias}.type = 'bid' THEN 'received' ELSE 'sent' END`
const PRICE_SIDE = (alias: string) => `CASE WHEN ${alias}.type = 'bid' THEN 'sent' ELSE 'received' END`

/**
 * A signer's trades that a contract signature index bump cancelled and that they still have to re-create.
 *
 * Events are ordered by `(timestamp, log_index)`: block times strictly increase on Ethereum and Polygon, so
 * a shared timestamp means a shared block, and the log index orders events inside it. A trade counts when,
 * at the bump that invalidated it, it was otherwise still valid: unexpired, signed against both current
 * indexes, not cancelled by its signer and not used up. It is then left out once it expired, was re-created
 * on a marketplace the bump didn't reach, or its asset can no longer be listed (NFT sold, item sold out).
 *
 * Re-created means a newer trade for the same asset was signed, whatever became of it since. Once the signer
 * re-lists, the cancelled trade stays answered even if that listing later expires, sells or is cancelled:
 * asking again would nag about something they already acted on.
 */
export function getContractBumpCancelledTradesQuery(filters: CancelledTradesFilters): SQLStatement {
  const signer = filters.signer.toLowerCase()
  const types = filters.types?.length ? SQL` AND t.type = ANY(${filters.types}::marketplace.trade_type[])` : SQL``
  return SQL`WITH signer_assets AS NOT MATERIALIZED (
    -- One row per asset of each of the signer's trades. Inlined at each use, so every join can reach the
    -- trade_id index; materialized, it is a scan with no index that the candidates join against row by row.
    `
    .append(getTradeAssetsWithValuesQuery(SQL`t.signer = ${signer}`.append(types)))
    .append(
      SQL`
  ), bumped AS (
    SELECT t.id, t.type, t.network, t.chain_id, t.contract, t.created_at, t.expires_at, t.checks,
      ARRAY[t.hashed_signature, t.trade_digest] AS keys, n.squid_network,
      bump.timestamp AS bump_timestamp, bump.log_index AS bump_log_index
    FROM marketplace.trades t
    CROSS JOIN LATERAL (SELECT `
    )
    .append(squidTradesNetwork('t'))
    .append(
      SQL` AS squid_network) n
    -- Counters only ever increase, so the bump that invalidated the trade is the lowest value past the signed one.
    JOIN LATERAL (
      SELECT e.timestamp, e.log_index
      FROM squid_trades.signature_index_increase e
      WHERE e.kind = 'contract' AND e.address = LOWER(t.contract) AND e.contract = LOWER(t.contract)
        AND e.network = n.squid_network AND e.new_value > (t.checks ->> 'contractSignatureIndex')::numeric
      ORDER BY e.new_value
      LIMIT 1
    ) bump ON TRUE
    WHERE t.signer = ${signer} AND t.expires_at > now()`
    )
    .append(types)
    .append(
      SQL`
  ), cancelled AS (
    SELECT b.* FROM bumped b
    WHERE b.expires_at > to_timestamp(b.bump_timestamp / 1000)
      AND (b.checks ->> 'contractSignatureIndex')::numeric = COALESCE((
        SELECT MAX(e.new_value) FROM squid_trades.signature_index_increase e
        WHERE e.kind = 'contract' AND e.address = LOWER(b.contract) AND e.contract = LOWER(b.contract)
          AND e.network = b.squid_network AND (e.timestamp, e.log_index) < (b.bump_timestamp, b.bump_log_index)
      ), 0)
      AND (b.checks ->> 'signerSignatureIndex')::numeric = COALESCE((
        SELECT MAX(e.new_value) FROM squid_trades.signature_index_increase e
        WHERE e.kind = 'signer' AND e.address = ${signer} AND e.contract = LOWER(b.contract)
          AND e.network = b.squid_network AND (e.timestamp, e.log_index) < (b.bump_timestamp, b.bump_log_index)
      ), 0)
      AND NOT EXISTS (
        SELECT 1 FROM squid_trades.trade st
        WHERE st.signature = ANY(b.keys) AND st.action = 'cancelled' AND LOWER(st.caller) = ${signer}
          AND (st.timestamp, st.log_index) < (b.bump_timestamp, b.bump_log_index)
      )
      AND (
        SELECT COUNT(*) FROM squid_trades.trade st
        WHERE st.signature = ANY(b.keys) AND st.action = 'executed'
          AND (st.timestamp, st.log_index) < (b.bump_timestamp, b.bump_log_index)
      ) < (b.checks ->> 'uses')::numeric
  ), with_assets AS (
    SELECT c.*, a.contract_address AS asset_contract, a.token_id, a.item_id,
      price.asset_type AS price_asset_type, price.amount AS price_amount
    FROM cancelled c
    JOIN signer_assets a ON a.id = c.id AND a.direction::text = `
    )
    .append(ASSET_SIDE('c'))
    .append(
      SQL`
    LEFT JOIN signer_assets price ON price.id = c.id AND price.direction::text = `
    )
    .append(PRICE_SIDE('c'))
    .append(
      SQL`
  ), live AS (
    -- The signer's trades no contract bump has invalidated: a re-creation of a cancelled one, if newer.
    SELECT a.type, a.network, a.created_at, a.contract_address AS asset_contract, a.token_id, a.item_id
    FROM signer_assets a
    WHERE a.direction::text = `
    )
    .append(ASSET_SIDE('a'))
    .append(
      SQL`
      AND NOT EXISTS (
        SELECT 1 FROM squid_trades.signature_index_increase e
        WHERE e.kind = 'contract' AND e.address = LOWER(a.contract) AND e.contract = LOWER(a.contract)
          AND e.network = `
    )
    .append(squidTradesNetwork('a'))
    .append(
      SQL` AND e.new_value > (a.checks ->> 'contractSignatureIndex')::numeric
      )
  ), unrecreated AS (
    -- Candidates and live trades share one window per asset instead of an anti-join, which plans badly on misestimates.
    SELECT * FROM (
      SELECT u.*, MAX(u.created_at) FILTER (WHERE u.live)
        OVER (PARTITION BY u.type, u.network, u.asset_contract, u.token_id, u.item_id) AS recreated_at
      FROM (
        SELECT w.id, w.type, w.network, w.chain_id, w.contract, w.created_at, w.expires_at, w.bump_timestamp,
          w.asset_contract, w.token_id, w.item_id, w.price_asset_type, w.price_amount, false AS live
        FROM with_assets w
        UNION ALL
        SELECT NULL, l.type, l.network, NULL, NULL, l.created_at, NULL, NULL, l.asset_contract, l.token_id, l.item_id, NULL, NULL, true
        FROM live l
      ) u
    ) m
    WHERE NOT m.live AND (m.recreated_at IS NULL OR m.recreated_at <= m.created_at)
  ), pending AS (
    -- One row per asset: a signer with several cancelled trades for the same asset re-creates it once.
    SELECT DISTINCT ON (w.type, w.asset_contract, w.token_id, w.item_id)
      w.id, w.type, w.network, w.chain_id, w.contract, w.created_at, w.expires_at, w.bump_timestamp,
      w.asset_contract, w.token_id, w.item_id, w.price_asset_type, w.price_amount,
      nft.name AS nft_name, COALESCE(nft.image, item.image) AS image, item.metadata_id
    FROM unrecreated w
    LEFT JOIN `
    )
    .append(MARKETPLACE_SQUID_SCHEMA)
    .append(
      SQL`.nft nft ON nft.contract_address = w.asset_contract AND nft.token_id = w.token_id::numeric
    LEFT JOIN `
    )
    .append(MARKETPLACE_SQUID_SCHEMA)
    .append(
      SQL`.item item ON item.collection_id = w.asset_contract AND item.blockchain_id = w.item_id::numeric
    WHERE CASE w.type
        WHEN 'public_nft_order' THEN nft.owner_address = ${signer}
        WHEN 'public_item_order' THEN item.available > 0
        ELSE (w.token_id IS NULL OR nft.owner_address <> ${signer}) AND (w.item_id IS NULL OR item.available > 0)
      END
    ORDER BY w.type, w.asset_contract, w.token_id, w.item_id, w.created_at DESC
  ), page AS (
    SELECT * FROM pending ORDER BY created_at DESC, id LIMIT ${filters.first} OFFSET ${filters.skip}
  )
  -- The total comes from its own row, joined to the page, so a page past the end still answers it.
  SELECT page.id, page.type, page.network, page.chain_id, page.contract, page.created_at, page.expires_at,
    page.bump_timestamp::text AS cancelled_at, page.asset_contract, page.token_id, page.item_id,
    COALESCE(page.nft_name, `
    )
    .append(ITEM_NAME_EXPRESSION)
    .append(
      SQL`) AS name, page.image,
    page.price_asset_type, page.price_amount::text AS price_amount, totals.total
  FROM (SELECT COUNT(*) AS total FROM pending) totals
  LEFT JOIN page ON TRUE
  LEFT JOIN `
    )
    .append(MARKETPLACE_SQUID_SCHEMA)
    .append(
      SQL`.metadata metadata ON metadata.id = page.metadata_id
  LEFT JOIN `
    )
    .append(MARKETPLACE_SQUID_SCHEMA)
    .append(
      SQL`.wearable wearable ON wearable.id = metadata.wearable_id
  LEFT JOIN `
    )
    .append(MARKETPLACE_SQUID_SCHEMA)
    .append(
      SQL`.emote emote ON emote.id = metadata.emote_id
  ORDER BY page.created_at DESC, page.id`
    )
}
