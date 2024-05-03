/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'
import { DEFAULT_LIST_ID } from './1678303321034_default-list'

const LISTS_TABLE = 'lists'
const DEFAULT_LIST_NAME = 'Wishlist'
const DEFAULT_LIST_DESCRIPTION = 'Find all your wished items here'
const OLD_DEFAULT_LIST_NAME = 'Favorites'
const OLD_DEFAULT_LIST_DESCRIPTION = 'Find all your favorites here'

export const shorthands: ColumnDefinitions | undefined = undefined

// TODO: handle the following eslint-disable statement
// eslint-disable-next-line @typescript-eslint/require-await
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(
    `UPDATE ${LISTS_TABLE} SET name = '${DEFAULT_LIST_NAME}', description = '${DEFAULT_LIST_DESCRIPTION}' WHERE id = '${DEFAULT_LIST_ID}'`
  )
}

// TODO: handle the following eslint-disable statement
// eslint-disable-next-line @typescript-eslint/require-await
export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(
    `UPDATE ${LISTS_TABLE} SET name = '${OLD_DEFAULT_LIST_NAME}', description = '${OLD_DEFAULT_LIST_DESCRIPTION}' WHERE id = '${DEFAULT_LIST_ID}'`
  )
}
