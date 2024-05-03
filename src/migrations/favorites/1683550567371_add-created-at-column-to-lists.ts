/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'
import { LISTS_TABLE } from './1677778846950_lists-and-picks'

export const shorthands: ColumnDefinitions | undefined = undefined

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addColumns(LISTS_TABLE, {
    created_at: { type: 'timestamp', notNull: true, default: pgm.func('now()') }
  })
  pgm.createIndex(LISTS_TABLE, 'created_at')
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropIndex(LISTS_TABLE, 'created_at')
  pgm.dropColumn(LISTS_TABLE, 'created_at')
}
