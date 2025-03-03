/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'
import { ContractName, getContract } from 'decentraland-transactions'
import { MARKETPLACE_SQUID_SCHEMA } from '../../constants'
import { getEthereumChainId, getPolygonChainId } from '../../logic/chainIds'

const materializedViewName = 'mv_trades'

export const shorthands: ColumnDefinitions | undefined = undefined

export async function up(pgm: MigrationBuilder): Promise<void> {
  const marketplacePolygon = getContract(ContractName.OffChainMarketplace, getPolygonChainId())
  const marketplaceEthereum = getContract(ContractName.OffChainMarketplace, getEthereumChainId())

  const viewSQL = `
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
    `

  pgm.createMaterializedView(materializedViewName, { ifNotExists: true }, viewSQL)
  pgm.addIndex(materializedViewName, ['id'], { name: 'idx_mv_trades_id', unique: true, ifNotExists: true })
  pgm.addIndex(materializedViewName, ['status', 'type'], { name: 'idx_mv_trades_status_type', ifNotExists: true })
  pgm.addIndex(materializedViewName, ['created_at'], { name: 'idx_mv_trades_created_at', ifNotExists: true })
  pgm.addIndex(materializedViewName, ['sent_nft_category'], { name: 'idx_mv_trades_category', ifNotExists: true })
  pgm.addIndex(materializedViewName, ['contract_address_sent', 'sent_token_id'], {
    name: 'idx_mv_trades_contract_token',
    ifNotExists: true
  })

  // Set the owner of the materialized view
  pgm.sql(`
    ALTER MATERIALIZED VIEW marketplace.${materializedViewName} OWNER TO mv_trades_owner;
  `)

  // Create refresh function
  pgm.sql(`
    CREATE OR REPLACE FUNCTION refresh_trades_mv()
        RETURNS TRIGGER
        LANGUAGE plpgsql
        AS $$
        BEGIN
        REFRESH MATERIALIZED VIEW CONCURRENTLY marketplace.${materializedViewName};
        RETURN NULL;
    END;
    $$;
  `)

  // Create triggers with exception handling
  pgm.sql(`
    DO $$
    BEGIN
      BEGIN
        CREATE TRIGGER refresh_trades_mv_on_trades
        AFTER INSERT OR UPDATE OR DELETE
        ON marketplace.trades
        FOR EACH STATEMENT
        EXECUTE FUNCTION refresh_trades_mv();
      EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'Insufficient privileges to create trigger refresh_trades_mv_on_trades';
      END;

      BEGIN
        CREATE TRIGGER refresh_trades_mv_on_nft
        AFTER INSERT OR UPDATE OR DELETE
        ON ${MARKETPLACE_SQUID_SCHEMA}.nft
        FOR EACH STATEMENT
        EXECUTE FUNCTION refresh_trades_mv();
      EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'Insufficient privileges to create trigger refresh_trades_mv_on_nft';
      END;

      BEGIN
        CREATE TRIGGER refresh_trades_mv_on_item
        AFTER INSERT OR UPDATE OR DELETE
        ON ${MARKETPLACE_SQUID_SCHEMA}.item
        FOR EACH STATEMENT
        EXECUTE FUNCTION refresh_trades_mv();
      EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'Insufficient privileges to create trigger refresh_trades_mv_on_item';
      END;

      BEGIN
        CREATE TRIGGER refresh_trades_mv_on_squid_trades_trade
        AFTER INSERT OR UPDATE OR DELETE
        ON squid_trades.trade
        FOR EACH STATEMENT
        EXECUTE FUNCTION refresh_trades_mv();
      EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'Insufficient privileges to create trigger refresh_trades_mv_on_squid_trades_trade';
      END;

      BEGIN
        CREATE TRIGGER refresh_trades_mv_on_signature_index
        AFTER INSERT OR UPDATE OR DELETE
        ON squid_trades.signature_index
        FOR EACH STATEMENT
        EXECUTE FUNCTION refresh_trades_mv();
      EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'Insufficient privileges to create trigger refresh_trades_mv_on_signature_index';
      END;
    END
    $$;
  `)
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // Usar bloques DO para manejar excepciones al eliminar triggers
  pgm.sql(`
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

  // Continuar con el resto de las operaciones que sí tienen permisos
  pgm.dropIndex(materializedViewName, 'idx_mv_trades_item_id', { ifExists: true })
  pgm.dropIndex(materializedViewName, 'idx_mv_trades_contract_token', { ifExists: true })
  pgm.dropIndex(materializedViewName, 'idx_mv_trades_category', { ifExists: true })
  pgm.dropIndex(materializedViewName, 'idx_mv_trades_created_at', { ifExists: true })
  pgm.dropIndex(materializedViewName, 'idx_mv_trades_status_type', { ifExists: true })
  pgm.dropMaterializedView(materializedViewName, { ifExists: true })
  pgm.dropFunction('refresh_trades_mv', [], { ifExists: true, cascade: true })
}
