/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'
import { TradeType, TradeAssetDirection } from '@dcl/schemas'

export const SCHEMA = 'marketplace'

export const TRADES_TABLE = 'trades'
export const TRADE_ASSETS_TABLE = 'trade_assets'
export const TRADE_ASSETS_ERC721_TABLE = 'trade_assets_erc721'
export const TRADE_ASSETS_ITEM_TABLE = 'trade_assets_item'
export const TRADE_ASSETS_ERC20_TABLE = 'trade_assets_erc20'
export const TRADE_TYPE = 'trade_type'
export const ASSET_DIRECTION_TYPE = 'asset_direction_type'
export const shorthands: ColumnDefinitions | undefined = undefined

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createType({ schema: SCHEMA, name: TRADE_TYPE }, [TradeType.BID])

  pgm.createTable(
    { schema: SCHEMA, name: TRADES_TABLE },
    {
      id: {
        type: 'uuid',
        notNull: true,
        primaryKey: true,
        unique: true,
        default: pgm.func('public.uuid_generate_v4()')
      },
      network: { type: 'text', notNull: true },
      chain_id: { type: 'integer', notNull: true },
      signature: { type: 'text', notNull: true, unique: true },
      hashed_signature: { type: 'text', notNull: true, unique: true },
      checks: { type: 'jsonb', notNull: true },
      signer: { type: 'varchar(42)', notNull: true },
      type: { type: TRADE_TYPE, notNull: true },
      expires_at: { type: 'timestamptz(3)', notNull: true },
      effective_since: { type: 'timestamptz(3)', notNull: true },
      created_at: { type: 'timestamptz(3)', notNull: true, default: pgm.func('now()::timestamptz(3)') }
    }
  )

  pgm.createType({ schema: SCHEMA, name: ASSET_DIRECTION_TYPE }, [TradeAssetDirection.SENT, TradeAssetDirection.RECEIVED])

  pgm.createTable(
    { schema: SCHEMA, name: TRADE_ASSETS_TABLE },
    {
      id: {
        type: 'uuid',
        notNull: true,
        primaryKey: true,
        unique: true,
        default: pgm.func('public.uuid_generate_v4()')
      },
      trade_id: {
        type: 'uuid',
        notNull: true,
        references: `"${TRADES_TABLE}"(id)`,
        onDelete: 'CASCADE'
      },
      direction: { type: ASSET_DIRECTION_TYPE, notNull: true },
      asset_type: {
        type: 'smallint', // (1: ERC20, 2: USD_PEGGED_MANA, 3: ERC721, 4: COLLECTION ITEM)
        notNull: true
      },
      contract_address: { type: 'varchar(42)', notNull: true },
      beneficiary: { type: 'varchar(42)', notNull: false },
      extra: { type: 'text', notNull: false },
      created_at: { type: 'timestamptz(3)', notNull: true, default: pgm.func('now()::timestamptz(3)') }
    }
  )

  pgm.createTable(
    { schema: SCHEMA, name: TRADE_ASSETS_ERC721_TABLE },
    {
      asset_id: {
        type: 'uuid',
        notNull: true,
        unique: true,
        references: `"${TRADE_ASSETS_TABLE}"(id)`,
        onDelete: 'CASCADE'
      },
      token_id: { type: 'text', notNull: true }
    }
  )

  pgm.createTable(
    { schema: SCHEMA, name: TRADE_ASSETS_ERC20_TABLE },
    {
      asset_id: {
        type: 'uuid',
        unique: true,
        notNull: true,
        references: `"${TRADE_ASSETS_TABLE}"(id)`,
        onDelete: 'CASCADE'
      },
      amount: { type: 'numeric(78,0)', notNull: true, check: 'amount >= 0 AND amount < 2^256' }
    }
  )

  pgm.createTable(
    { schema: SCHEMA, name: TRADE_ASSETS_ITEM_TABLE },
    {
      asset_id: {
        type: 'uuid',
        notNull: true,
        unique: true,
        references: `"${TRADE_ASSETS_TABLE}"(id)`,
        onDelete: 'CASCADE'
      },
      item_id: { type: 'text', notNull: true }
    }
  )
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable({ schema: SCHEMA, name: TRADE_ASSETS_ERC721_TABLE })
  pgm.dropTable({ schema: SCHEMA, name: TRADE_ASSETS_ERC20_TABLE })
  pgm.dropTable({ schema: SCHEMA, name: TRADE_ASSETS_ITEM_TABLE })
  pgm.dropTable({ schema: SCHEMA, name: TRADE_ASSETS_TABLE })
  pgm.dropTable({ schema: SCHEMA, name: TRADES_TABLE })
  pgm.dropType({ schema: SCHEMA, name: ASSET_DIRECTION_TYPE })
  pgm.dropType({ schema: SCHEMA, name: TRADE_TYPE })
}
