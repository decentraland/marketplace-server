import { IPgComponent } from '@dcl/pg-component'
import { ContractName, getContract } from 'decentraland-transactions'
import { MARKETPLACE_SQUID_SCHEMA } from '../../constants'
import { getEthereumChainId, getPolygonChainId } from '../chainIds'

export const TRADES_MV_NAME = 'mv_trades'
// Minimum time between materialized view refreshes. Writes on the source tables
// only pay a refresh when this interval has elapsed; refreshing on every statement
// starved the squid indexers (each nft/item statement paid a full CONCURRENTLY
// refresh, ~2s of temp-file I/O).
export const TRADES_MV_REFRESH_INTERVAL_SECONDS = 30

export async function recreateTradesMaterializedView(db: IPgComponent) {
  const marketplacePolygon = getContract(ContractName.OffChainMarketplace, getPolygonChainId())
  const marketplaceEthereum = getContract(ContractName.OffChainMarketplace, getEthereumChainId())
  const marketplacePolygonV2 = getContract(ContractName.OffChainMarketplaceV2, getPolygonChainId())
  const marketplaceEthereumV2 = getContract(ContractName.OffChainMarketplaceV2, getEthereumChainId())
  // Start transaction
  const client = await db.getPool().connect()
  try {
    await client.query('BEGIN')

    // Drop triggers with exception handling
    await client.query(`
      DO $$
      BEGIN
        BEGIN
          DROP TRIGGER IF EXISTS refresh_trades_mv_on_trades ON marketplace.trades;
        EXCEPTION WHEN insufficient_privilege THEN
          RAISE NOTICE 'Insufficient privileges to drop trigger refresh_trades_mv_on_trades';
        END;

        BEGIN
          DROP TRIGGER IF EXISTS refresh_trades_mv_on_nft ON ${MARKETPLACE_SQUID_SCHEMA}.nft;
        EXCEPTION WHEN insufficient_privilege THEN
          RAISE NOTICE 'Insufficient privileges to drop trigger refresh_trades_mv_on_nft';
        END;

        BEGIN
          DROP TRIGGER IF EXISTS refresh_trades_mv_on_item ON ${MARKETPLACE_SQUID_SCHEMA}.item;
        EXCEPTION WHEN insufficient_privilege THEN
          RAISE NOTICE 'Insufficient privileges to drop trigger refresh_trades_mv_on_item';
        END;

        BEGIN
          DROP TRIGGER IF EXISTS refresh_trades_mv_on_squid_trades_trade ON squid_trades.trade;
        EXCEPTION WHEN insufficient_privilege THEN
          RAISE NOTICE 'Insufficient privileges to drop trigger refresh_trades_mv_on_squid_trades_trade';
        END;

        BEGIN
          DROP TRIGGER IF EXISTS refresh_trades_mv_on_signature_index ON squid_trades.signature_index;
        EXCEPTION WHEN insufficient_privilege THEN
          RAISE NOTICE 'Insufficient privileges to drop trigger refresh_trades_mv_on_signature_index';
        END;
      END
      $$;
    `)

    // Drop materialized view
    await client.query(`DROP MATERIALIZED VIEW IF EXISTS marketplace.${TRADES_MV_NAME}`)

    // Drop function
    await client.query('DROP FUNCTION IF EXISTS refresh_trades_mv() CASCADE')

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
          MAX(av.nft_id)           FILTER (WHERE av.direction = 'sent') AS sent_nft_id,
          t.network,
          t.expires_at,
          MAX(t.contract) AS trade_contract,
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
              WHEN COUNT(DISTINCT st.id) FILTER (WHERE st.action = 'executed') >= (t.checks ->> 'uses')::int 
                                                                                      THEN 'sold'
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
              '${marketplaceEthereum.address}',
              '${marketplacePolygonV2.address}',
              '${marketplaceEthereumV2.address}'
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

    // Single-row gate recording the last refresh time, shared by every trigger.
    // `dirty` marks that writes arrived while the debounce gate was closed (a
    // refresh those writes never made it into); the app-side trailing flush uses
    // it to guarantee a debounced refresh is never permanently dropped.
    await client.query(`
      CREATE TABLE IF NOT EXISTS marketplace.mv_trades_refresh_state (
        id boolean PRIMARY KEY DEFAULT true CHECK (id),
        last_refresh timestamptz NOT NULL DEFAULT '-infinity',
        dirty boolean NOT NULL DEFAULT false
      );
    `)
    // Add the column on already-provisioned databases where the table predates it.
    await client.query('ALTER TABLE marketplace.mv_trades_refresh_state ADD COLUMN IF NOT EXISTS dirty boolean NOT NULL DEFAULT false')
    await client.query('INSERT INTO marketplace.mv_trades_refresh_state (id) VALUES (true) ON CONFLICT (id) DO NOTHING')
    // Trigger functions run as whoever performs the write. Every user able to run
    // the trigger successfully is already a member of mv_trades_owner (the REFRESH
    // itself requires it), so that role is exactly the right audience for the gate
    await client.query('GRANT SELECT, UPDATE ON marketplace.mv_trades_refresh_state TO mv_trades_owner')

    // Create refresh function. The first UPDATE is an atomic gate: only one writing
    // statement per interval wins and pays the refresh; concurrent writers skip
    // immediately (SKIP LOCKED) instead of queueing behind the winner. last_refresh
    // must be clock_timestamp() (wall clock), not now() (transaction start): a
    // long-running writing transaction would otherwise record a stale timestamp and
    // re-open the gate immediately. Worst-case staleness is the interval plus the
    // winner's remaining transaction time, since the row lock is held to commit.
    //
    // The gate winner also clears `dirty` up front: it is about to REFRESH, so its
    // snapshot supersedes any pending marker. Any write that commits after that
    // snapshot re-sets `dirty` below and is picked up by the trailing flush.
    //
    // When the gate is closed (debounced) the writer instead marks the state row
    // `dirty` so the app-side trailing flush knows changes arrived that this
    // interval's refresh did not capture. This second UPDATE intentionally blocks
    // on the gate winner's row lock: a writer whose change lands during an in-flight
    // refresh must wait until that refresh commits and then flag `dirty`, otherwise
    // its change could be silently dropped. It performs no REFRESH of its own, so it
    // does not reintroduce the per-statement CONCURRENTLY storm the gate prevents.
    await client.query(`
      CREATE OR REPLACE FUNCTION refresh_trades_mv()
          RETURNS TRIGGER
          LANGUAGE plpgsql
          AS $$
          BEGIN
          UPDATE marketplace.mv_trades_refresh_state s
             SET last_refresh = clock_timestamp(), dirty = false
            FROM (
              SELECT id FROM marketplace.mv_trades_refresh_state
               WHERE last_refresh < now() - interval '${TRADES_MV_REFRESH_INTERVAL_SECONDS} seconds'
               FOR UPDATE SKIP LOCKED
            ) gate
           WHERE s.id = gate.id;

          IF FOUND THEN
            REFRESH MATERIALIZED VIEW CONCURRENTLY marketplace.${TRADES_MV_NAME};
          ELSE
            UPDATE marketplace.mv_trades_refresh_state
               SET dirty = true
             WHERE id = true;
          END IF;

          RETURN NULL;
      END;
      $$;
    `)

    // Create triggers - Entire operation will fail if any trigger cannot be created
    await client.query(`
      -- First, drop triggers if they exist to avoid errors


      -- Then create all triggers without exception handling so the operation fails if there are any issues
      CREATE TRIGGER refresh_trades_mv_on_trades_assets_erc721
      AFTER INSERT OR UPDATE OR DELETE
      ON marketplace.trade_assets_erc721
      FOR EACH STATEMENT
      EXECUTE FUNCTION refresh_trades_mv();
      
      CREATE TRIGGER refresh_trades_mv_on_trades_assets_erc20
      AFTER INSERT OR UPDATE OR DELETE
      ON marketplace.trade_assets_erc20
      FOR EACH STATEMENT
      EXECUTE FUNCTION refresh_trades_mv();

      CREATE TRIGGER refresh_trades_mv_on_trades_assets_item
      AFTER INSERT OR UPDATE OR DELETE
      ON marketplace.trade_assets_item
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

    // MANDATORY: grant permissions for SELECT on all required tables
    // First grant permissions to mv_trades_owner on marketplace schema tables
    await client.query(`
      GRANT SELECT ON ALL TABLES IN SCHEMA marketplace TO mv_trades_owner;
      GRANT SELECT ON ALL TABLES IN SCHEMA squid_marketplace TO mv_trades_owner;
      GRANT SELECT ON ALL TABLES IN SCHEMA squid_trades TO mv_trades_owner;
    `)

    // Grant permissions to active squid users dynamically
    await client.query(`
      DO $$
      DECLARE
        schema_name TEXT;
        db_user TEXT;
      BEGIN
        FOR schema_name IN (SELECT schema FROM squids WHERE schema IS NOT NULL)
        LOOP
          FOR db_user IN (
            SELECT i.db_user 
            FROM indexers i 
            WHERE i.schema = schema_name
          )
          LOOP
            IF db_user IS NOT NULL THEN
              EXECUTE 'GRANT USAGE ON SCHEMA marketplace TO ' || quote_ident(db_user);
              EXECUTE 'GRANT mv_trades_owner TO ' || quote_ident(db_user);
            END IF;
          END LOOP;
        END LOOP;
      END $$;
    `)

    await client.query('GRANT SELECT ON ALL TABLES IN SCHEMA squid_marketplace TO dappsdata;')

    await client.query('COMMIT')
  } catch (error) {
    console.error('Error recreating materialized view', error)
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

// Trailing flush for the leading-edge debounce in refresh_trades_mv(). Writes that
// arrive while the gate is closed only mark the state row `dirty`; nothing refreshes
// the view for them until this runs. Intended to be invoked on an interval (~every
// TRADES_MV_REFRESH_INTERVAL_SECONDS) so any debounced change is reflected within one
// interval instead of waiting indefinitely for the next unrelated trigger.
//
// The claim UPDATE is the same atomic gate the trigger uses: it only proceeds when
// the row is `dirty` AND the debounce interval has elapsed, and it clears `dirty` +
// stamps last_refresh in one statement (FOR UPDATE SKIP LOCKED). That prevents two
// flushers, or a flusher racing a trigger, from both refreshing, and it re-closes the
// debounce gate so the concurrent trigger path stays quiet. As with the trigger, any
// write committing after the REFRESH snapshot re-sets `dirty` and is caught next tick.
// Returns true when it performed a REFRESH, false when there was nothing to flush.
export async function flushTradesMaterializedViewIfDirty(db: IPgComponent): Promise<boolean> {
  const claim = await db.query<{ id: boolean }>(`
    UPDATE marketplace.mv_trades_refresh_state s
       SET last_refresh = clock_timestamp(), dirty = false
      FROM (
        SELECT id FROM marketplace.mv_trades_refresh_state
         WHERE dirty = true
           AND last_refresh < now() - interval '${TRADES_MV_REFRESH_INTERVAL_SECONDS} seconds'
         FOR UPDATE SKIP LOCKED
      ) gate
     WHERE s.id = gate.id
    RETURNING s.id;
  `)

  if (!claim.rowCount) {
    return false
  }

  try {
    await db.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY marketplace.${TRADES_MV_NAME}`)
  } catch (error) {
    // The claim already cleared `dirty`, but the REFRESH failed — the changes it was meant to capture
    // are still unreflected. Re-mark `dirty` so the next tick retries instead of silently dropping them
    // (the exact bug this flush exists to prevent), then rethrow so the job's onError surfaces it.
    await db.query('UPDATE marketplace.mv_trades_refresh_state SET dirty = true WHERE id = true')
    throw error
  }
  return true
}
