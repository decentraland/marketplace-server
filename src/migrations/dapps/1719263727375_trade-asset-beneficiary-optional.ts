/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'
import { TRADE_ASSETS_TABLE } from './1718991797670_trades-and-asset-trades-table'

export const shorthands: ColumnDefinitions | undefined = undefined

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.alterColumn(TRADE_ASSETS_TABLE, 'beneficiary', { allowNull: true })
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.alterColumn(TRADE_ASSETS_TABLE, 'beneficiary', { allowNull: false })
}
