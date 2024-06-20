/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const TRADES_TABLE = 'trades'
export const TRADE_ASSETS_TABLE = 'trade_assets'

export const shorthands: ColumnDefinitions | undefined = undefined

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createExtension('uuid-ossp', { ifNotExists: true })

  pgm.createTable(TRADES_TABLE, {
    id: {
      type: 'uuid',
      notNull: true,
      primaryKey: true,
      unique: true,
      default: pgm.func('uuid_generate_v4()')
    },
    signature: {
      type: 'text',
      notNull: true,
      unique: true
    },
    checks: {
      type: 'jsonb',
      notNull: true
    },
    signer: {
      type: 'text',
      notNull: true
    },
    created_at: { type: 'timestamp', notNull: true, default: pgm.func('now()') }
  })

  pgm.createType('direction_type', ['sent', 'received'])

  pgm.createTable(TRADE_ASSETS_TABLE, {
    id: {
      type: 'uuid',
      notNull: true,
      primaryKey: true,
      unique: true,
      default: pgm.func('uuid_generate_v4()')
    },
    trade_id: {
      type: 'uuid',
      notNull: true,
      references: `${TRADES_TABLE}(id)`,
      onDelete: 'CASCADE'
    },
    direction: {
      type: 'direction_type',
      notNull: true
    },
    asset_type: {
      type: 'smallint', // (1: ERC20, 2: ERC721, 3: COLLECTION ITEM, 4: ERC20 WITH FEES)
      notNull: true
    },
    contract_address: {
      type: 'text',
      notNull: true
    },
    value: {
      type: 'numeric',
      notNull: true
    },
    beneficiary: {
      type: 'text',
      notNull: true
    },
    extra: {
      type: 'text',
      notNull: true
    },
    created_at: { type: 'timestamp', notNull: true, default: pgm.func('now()') }
  })
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropExtension('uuid-ossp')
  pgm.dropTable(TRADES_TABLE)
  pgm.dropTable(TRADE_ASSETS_TABLE)
  pgm.dropType('direction_type')
}
