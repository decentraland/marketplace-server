/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const PICKS_TABLE = 'picks'
export const LISTS_TABLE = 'lists'

export const shorthands: ColumnDefinitions | undefined = undefined

export function up(pgm: MigrationBuilder): void {
  pgm.createTable(LISTS_TABLE, {
    id: {
      type: 'uuid',
      notNull: true,
      primaryKey: true,
      unique: true,
      default: pgm.func('uuid_generate_v4()')
    },
    name: { type: 'text', notNull: true },
    description: { type: 'text', notNull: false },
    user_address: { type: 'text', notNull: true }
  })

  // Should create an index by those two columns
  pgm.addConstraint(LISTS_TABLE, 'name_user_address_unique', {
    unique: ['name', 'user_address']
  })

  pgm.createTable(PICKS_TABLE, {
    item_id: { type: 'text', notNull: true },
    user_address: { type: 'text', notNull: true },
    list_id: {
      type: 'uuid',
      notNull: true,
      unique: false,
      references: `${LISTS_TABLE}(id)`,
      onDelete: 'CASCADE'
    },
    created_at: { type: 'timestamp', notNull: true, default: pgm.func('now()') }
  })

  // Should create an index by the three columns compounded
  pgm.addConstraint(PICKS_TABLE, 'item_id_user_address_list_id_primary_key', {
    primaryKey: ['item_id', 'user_address', 'list_id']
  })

  pgm.createIndex(PICKS_TABLE, 'created_at')
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropConstraint(PICKS_TABLE, 'item_id_user_address_primary_key')
  pgm.dropIndex(PICKS_TABLE, 'created_at')
  pgm.dropTable(PICKS_TABLE)

  pgm.dropConstraint(LISTS_TABLE, 'name_user_address_unique')
  pgm.dropTable(LISTS_TABLE)
}
