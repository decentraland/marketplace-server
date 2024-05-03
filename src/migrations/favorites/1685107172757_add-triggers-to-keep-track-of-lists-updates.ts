/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'
import { PICKS_TABLE } from './1677778846950_lists-and-picks'
import { ACL_TABLE } from './1683320488882_acl'

export const shorthands: ColumnDefinitions | undefined = undefined

const ON_INSERT_FUNCTION_NAME = 'update_lists_updated_at_when_inserting_related_rows'
const ON_DELETE_FUNCTION_NAME = 'update_lists_updated_at_when_deleting_related_rows'

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createFunction(
    ON_INSERT_FUNCTION_NAME,
    [],
    {
      returns: 'TRIGGER',
      language: 'plpgsql',
      replace: true
    },
    `BEGIN
        UPDATE favorites.lists
        SET updated_at = NOW()
        WHERE id = NEW.list_id;
        RETURN NEW;
    END;`
  )

  pgm.createFunction(
    ON_DELETE_FUNCTION_NAME,
    [],
    {
      returns: 'TRIGGER',
      language: 'plpgsql',
      replace: true
    },
    `BEGIN
        UPDATE favorites.lists
        SET updated_at = NOW()
        WHERE id = OLD.list_id;
        RETURN NULL;
    END;`
  )

  const tables = [PICKS_TABLE, ACL_TABLE]
  const functions = [
    { operation: 'INSERT', name: ON_INSERT_FUNCTION_NAME },
    { operation: 'DELETE', name: ON_DELETE_FUNCTION_NAME }
  ]

  tables.forEach(tableName => {
    functions.forEach(({ operation, name: functionName }) => {
      pgm.createTrigger(tableName, `trigger_update_lists_updated_at_on_${operation.toLowerCase()}`, {
        when: 'AFTER',
        operation,
        function: functionName,
        level: 'ROW'
      })
    })
  })
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTrigger(PICKS_TABLE, 'trigger_update_lists_updated_at_on_insert')
  pgm.dropTrigger(PICKS_TABLE, 'trigger_update_lists_updated_at_on_delete')
  pgm.dropTrigger(ACL_TABLE, 'trigger_update_lists_updated_at_on_insert')
  pgm.dropTrigger(ACL_TABLE, 'trigger_update_lists_updated_at_on_delete')
  pgm.dropFunction(ON_INSERT_FUNCTION_NAME, [])
  pgm.dropFunction(ON_DELETE_FUNCTION_NAME, [])
}
