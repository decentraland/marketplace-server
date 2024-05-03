/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'
import { LISTS_TABLE } from './1677778846950_lists-and-picks'

export const shorthands: ColumnDefinitions | undefined = undefined
export const ACL_TABLE = 'acl'
const PERMISSION_TYPE = 'permissions'

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createType(PERMISSION_TYPE, ['edit', 'view'])
  pgm.createTable(ACL_TABLE, {
    list_id: {
      type: 'uuid',
      notNull: true,
      unique: false,
      references: `${LISTS_TABLE}(id)`,
      onDelete: 'CASCADE'
    },
    permission: { type: 'permissions', notNull: true },
    grantee: { type: 'text', notNull: true }
  })
  pgm.addConstraint(ACL_TABLE, 'list_id_permissions_grantee_primary_key', {
    primaryKey: ['list_id', 'permission', 'grantee']
  })
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable(ACL_TABLE)
  pgm.dropType(PERMISSION_TYPE)
}
