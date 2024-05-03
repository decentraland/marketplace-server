/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'
import { LISTS_TABLE } from './1677778846950_lists-and-picks'

export const shorthands: ColumnDefinitions | undefined = undefined

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.alterColumn(LISTS_TABLE, 'name', { type: 'VARCHAR(32)', notNull: true })
  pgm.alterColumn(LISTS_TABLE, 'description', { type: 'VARCHAR(100)', notNull: false })
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.alterColumn(LISTS_TABLE, 'name', { type: 'text', notNull: true })
  pgm.alterColumn(LISTS_TABLE, 'description', { type: 'text', notNull: false })
}
