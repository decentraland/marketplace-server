import { IPgComponent } from '@well-known-components/pg-component'
import { ContractName, getContract } from 'decentraland-transactions'
import { MARKETPLACE_SQUID_SCHEMA } from '../../constants'
import { getEthereumChainId, getPolygonChainId } from '../chainIds'

export const TRADES_MV_NAME = 'mv_trades'

export async function recreateTradesMaterializedView(db: IPgComponent) {
  const marketplacePolygon = getContract(ContractName.OffChainMarketplace, getPolygonChainId())
  const marketplaceEthereum = getContract(ContractName.OffChainMarketplace, getEthereumChainId())

  // Start transaction
  const client = await db.getPool().connect()
  try {
    await client.query('BEGIN')

    // Create role if not exists
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mv_trades_owner') THEN
          CREATE ROLE mv_trades_owner NOLOGIN;
        END IF;
      END
      $$;
      
      -- Grant the role to the database user
      GRANT mv_trades_owner TO CURRENT_USER;
    `)

    // Drop triggers
    await client.query('DROP TRIGGER IF EXISTS refresh_trades_mv_on_trades ON marketplace.trades')
    await client.query(`DROP TRIGGER IF EXISTS refresh_trades_mv_on_nft ON ${MARKETPLACE_SQUID_SCHEMA}.nft`)
    await client.query(`DROP TRIGGER IF EXISTS refresh_trades_mv_on_item ON ${MARKETPLACE_SQUID_SCHEMA}.item`)
    await client.query('DROP TRIGGER IF EXISTS refresh_trades_mv_on_squid_trades_trade ON squid_trades.trade')
    await client.query('DROP TRIGGER IF EXISTS refresh_trades_mv_on_signature_index ON squid_trades.signature_index')

    // Drop materialized view
    await client.query(`DROP MATERIALIZED VIEW IF EXISTS marketplace.${TRADES_MV_NAME}`)

    // Drop function
    await client.query('DROP FUNCTION IF EXISTS refresh_trades_mv()')

    // Create materialized view
    await client.query(`
      CREATE MATERIALIZED VIEW marketplace.${TRADES_MV_NAME} AS
      WITH trades_owner_ok AS (
          SELECT t.id
          FROM marketplace.trades t
          JOIN marketplace.trade_assets ta ON t.id = ta.trade_id
          LEFT JOIN marketplace.trade_assets_erc721 erc721_asset ON ta.id = erc721_asset.asset_id
          LEFT JOIN ${MARKETPLACE_SQUID_SCHEMA}.nft nft
          ON  ta.contract_address = nft.contract_address
          AND ta.direction = 'sent'
          AND nft.token_id = erc721_asset.token_id::numeric
          WHERE t.type IN ('public_item_order', 'public_nft_order')
          GROUP BY t.id
          HAVING bool_and(ta.direction != 'sent' OR nft.owner_address = t.signer)
      )
      SELECT
          t.id,
          t.created_at,
          t.type,
          t.signer,
          MAX(CASE WHEN av.direction = 'sent'     THEN av.contract_address END) AS contract_address_sent,
          MAX(CASE WHEN av.direction = 'received' THEN av.amount END)          AS amount_received,
          MAX(CASE WHEN av.direction = 'sent'     THEN av.available END)       AS available,
          json_object_agg(
              av.direction,
              json_build_object(
                  'contract_address', av.contract_address,
                  'direction',        av.direction,
                  'beneficiary',      av.beneficiary,
                  'extra',            av.extra,
                  'token_id',         av.token_id,
                  'item_id',          av.item_id,
                  'amount',           av.amount,
                  'creator',          av.creator,
                  'owner',            av.nft_owner,
                  'category',         av.category,
                  'nft_id',           av.nft_id,
                  'issued_id',        av.issued_id,
                  'nft_name',         av.nft_name
              )
          ) AS assets,

          MAX(av.contract_address) FILTER (WHERE av.direction = 'sent') AS sent_contract_address,
          MAX(av.token_id)         FILTER (WHERE av.direction = 'sent') AS sent_token_id,
          MAX(av.category)         FILTER (WHERE av.direction = 'sent') AS sent_nft_category,
          MAX(av.item_id)          FILTER (WHERE av.direction = 'sent') AS sent_item_id,
          CASE
              WHEN COUNT(CASE WHEN st.action = 'cancelled' THEN 1 END) > 0             THEN 'cancelled'
              WHEN t.expires_at < now()::timestamptz(3)                                THEN 'cancelled'
              WHEN (
                  (si_signer.index IS NOT NULL
                      AND si_signer.index != (t.checks ->> 'signerSignatureIndex')::int)
                  OR (si_signer.index IS NULL
                      AND (t.checks ->> 'signerSignatureIndex')::int != 0)
                  )
                                                                                      THEN 'cancelled'
              WHEN (
                  (si_contract.index IS NOT NULL
                      AND si_contract.index != (t.checks ->> 'contractSignatureIndex')::int)
                  OR (si_contract.index IS NULL
                      AND (t.checks ->> 'contractSignatureIndex')::int != 0)
                  )
                                                                                      THEN 'cancelled'
              WHEN COUNT(CASE WHEN st.action = 'executed' THEN 1 END)
                  >= (t.checks ->> 'uses')::int                                       THEN 'sold'
              ELSE 'open'
          END AS status

      FROM marketplace.trades      AS t
      JOIN trades_owner_ok         AS ok
      ON t.id = ok.id

      JOIN (
          SELECT
              ta.id,
              ta.trade_id,
              ta.contract_address,
              ta.direction,
              ta.beneficiary,
              ta.extra,
              erc721_asset.token_id,
              erc20_asset.amount,
              item.creator,
              item.available,
              nft.owner_address      AS nft_owner,
              nft.category,
              nft.id                AS nft_id,
              nft.issued_id         AS issued_id,
              nft.name             AS nft_name,
              coalesce(nft.item_blockchain_id::text, item_asset.item_id) AS item_id
          FROM marketplace.trade_assets AS ta
          LEFT JOIN marketplace.trade_assets_erc721 AS erc721_asset
              ON ta.id = erc721_asset.asset_id
          LEFT JOIN marketplace.trade_assets_erc20 AS erc20_asset
              ON ta.id = erc20_asset.asset_id
          LEFT JOIN marketplace.trade_assets_item AS item_asset
              ON ta.id = item_asset.asset_id
          LEFT JOIN ${MARKETPLACE_SQUID_SCHEMA}.item AS item
              ON ta.contract_address = item.collection_id
              AND item_asset.item_id::numeric = item.blockchain_id
          LEFT JOIN ${MARKETPLACE_SQUID_SCHEMA}.nft AS nft
              ON ta.contract_address = nft.contract_address
              AND erc721_asset.token_id::numeric = nft.token_id
      ) AS av
      ON t.id = av.trade_id

      LEFT JOIN squid_trades.trade AS st
      ON st.signature = t.hashed_signature

      LEFT JOIN squid_trades.signature_index AS si_signer
      ON LOWER(si_signer.address) = LOWER(t.signer)

      LEFT JOIN (
          SELECT *
          FROM squid_trades.signature_index idx
          WHERE LOWER(idx.address) IN (
              '${marketplacePolygon.address}',
              '${marketplaceEthereum.address}'
          )
      ) AS si_contract
      ON t.network = si_contract.network

      WHERE t.type IN ('public_item_order', 'public_nft_order')
      GROUP BY
          t.id,
          t.type,
          t.created_at,
          t.network,
          t.chain_id,
          t.signer,
          t.checks,
          si_contract.index,
          si_signer.index;
    `)

    // Create primary index
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_trades_id ON marketplace.${TRADES_MV_NAME} (id)`)

    // Create additional indexes for performance optimization
    // Status and type - improves queries filtering by open trades and specific trade types
    await client.query(`CREATE INDEX IF NOT EXISTS idx_mv_trades_status_type ON marketplace.${TRADES_MV_NAME} (status, type)`)
    // Creation date - optimizes queries sorting by recently listed
    await client.query(`CREATE INDEX IF NOT EXISTS idx_mv_trades_created_at ON marketplace.${TRADES_MV_NAME} (created_at DESC)`)
    // Category - improves queries filtering by NFT category
    await client.query(`CREATE INDEX IF NOT EXISTS idx_mv_trades_category ON marketplace.${TRADES_MV_NAME} (sent_nft_category)`)
    // Contract and token - optimizes joins with NFT tables
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_mv_trades_contract_token ON marketplace.${TRADES_MV_NAME} (contract_address_sent, sent_token_id)`
    )

    // Create refresh function
    await client.query(`
      CREATE OR REPLACE FUNCTION refresh_trades_mv()
          RETURNS TRIGGER
          LANGUAGE plpgsql
          AS $$
          BEGIN
          REFRESH MATERIALIZED VIEW CONCURRENTLY marketplace.${TRADES_MV_NAME};
          RETURN NULL;
      END;
      $$;
    `)

    // Create triggers
    await client.query(`
      CREATE TRIGGER refresh_trades_mv_on_trades
      AFTER INSERT OR UPDATE OR DELETE
      ON marketplace.trades
      FOR EACH STATEMENT
      EXECUTE FUNCTION refresh_trades_mv();

      CREATE TRIGGER refresh_trades_mv_on_nft
      AFTER INSERT OR UPDATE OR DELETE
      ON ${MARKETPLACE_SQUID_SCHEMA}.nft
      FOR EACH STATEMENT
      EXECUTE FUNCTION refresh_trades_mv();

      CREATE TRIGGER refresh_trades_mv_on_item
      AFTER INSERT OR UPDATE OR DELETE
      ON ${MARKETPLACE_SQUID_SCHEMA}.item
      FOR EACH STATEMENT
      EXECUTE FUNCTION refresh_trades_mv();

      CREATE TRIGGER refresh_trades_mv_on_squid_trades_trade
      AFTER INSERT OR UPDATE OR DELETE
      ON squid_trades.trade
      FOR EACH STATEMENT
      EXECUTE FUNCTION refresh_trades_mv();

      CREATE TRIGGER refresh_trades_mv_on_signature_index
      AFTER INSERT OR UPDATE OR DELETE
      ON squid_trades.signature_index
      FOR EACH STATEMENT
      EXECUTE FUNCTION refresh_trades_mv();
    `)

    // Set the owner of the materialized view
    await client.query(`ALTER MATERIALIZED VIEW marketplace.${TRADES_MV_NAME} OWNER TO mv_trades_owner;`)

    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
