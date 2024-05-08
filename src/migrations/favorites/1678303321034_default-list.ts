/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

const LISTS_TABLE = 'lists'
export const DEFAULT_LIST_ID = '70ab6873-4a03-4eb2-b331-4b8be0e0b8af'
const DEFAULT_LIST_NAME = 'Favorites'
const DEFAULT_LIST_DESCRIPTION = 'Find all your favorites here'
export const DEFAULT_LIST_USER_ADDRESS = '0x0000000000000000000000000000000000000000'

export const shorthands: ColumnDefinitions | undefined = undefined

// TODO: handle the following eslint-disable statement
// eslint-disable-next-line @typescript-eslint/require-await
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(
    `INSERT INTO ${LISTS_TABLE} (id, name, description, user_address) VALUES ('${DEFAULT_LIST_ID}', '${DEFAULT_LIST_NAME}', '${DEFAULT_LIST_DESCRIPTION}', '${DEFAULT_LIST_USER_ADDRESS}')`
  )
}

// TODO: handle the following eslint-disable statement
// eslint-disable-next-line @typescript-eslint/require-await
export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DELETE FROM ${LISTS_TABLE} WHERE id = '${DEFAULT_LIST_ID}'`)
}
