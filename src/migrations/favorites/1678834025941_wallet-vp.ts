/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from 'node-pg-migrate'

export const WALLET_VP = 'voting'

// TODO: handle the following eslint-disable statement
// eslint-disable-next-line @typescript-eslint/require-await
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable(WALLET_VP, {
    user_address: { type: 'text', notNull: true, primaryKey: true },
    power: { type: 'integer', notNull: true }
  })
}

// TODO: handle the following eslint-disable statement
// eslint-disable-next-line @typescript-eslint/require-await
export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable(WALLET_VP)
}
