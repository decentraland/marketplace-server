/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const SCHEMA = 'marketplace'

export const TRADES_TABLE = 'trades'
export const TRADE_ASSETS_TABLE = 'trade_assets'
export const TRADE_TYPE = 'trade_type'
export const ASSET_DIRECTION_TYPE = 'asset_direction_type'
export const shorthands: ColumnDefinitions | undefined = undefined

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createType({ schema: SCHEMA, name: TRADE_TYPE }, ['bid', 'public_order'])

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
      checks: { type: 'jsonb', notNull: true },
      signer: { type: 'varchar(42)', notNull: true },
      type: { type: TRADE_TYPE, notNull: true },
      expires_at: { type: 'timestamp', notNull: true },
      effective_since: { type: 'timestamp', notNull: true },
      created_at: { type: 'timestamp', notNull: true, default: pgm.func('now()') }
    }
  )

  pgm.createType({ schema: SCHEMA, name: ASSET_DIRECTION_TYPE }, ['sent', 'received'])

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
        type: 'smallint', // (1: ERC20, 2: ERC721, 3: COLLECTION ITEM)
        notNull: true
      },
      contract_address: { type: 'varchar(42)', notNull: true },
      value: { type: 'numeric(78, 0)', notNull: true },
      beneficiary: { type: 'varchar(42)', notNull: false },
      extra: { type: 'text', notNull: false },
      created_at: { type: 'timestamp', notNull: true, default: pgm.func('now()') }
    }
  )
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable({ schema: SCHEMA, name: TRADE_ASSETS_TABLE })
  pgm.dropTable({ schema: SCHEMA, name: TRADES_TABLE })
  pgm.dropType({ schema: SCHEMA, name: ASSET_DIRECTION_TYPE })
  pgm.dropType({ schema: SCHEMA, name: TRADE_TYPE })
}
