/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'
import { LISTS_TABLE } from './1677778846950_lists-and-picks'

export const shorthands: ColumnDefinitions | undefined = undefined

const FUNCTION_NAME = 'update_lists_updated_at'
const TRIGGER_NAME = 'trigger_update_lists_updated_at'

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addColumns(LISTS_TABLE, {
    updated_at: { type: 'timestamp', default: null }
  })
  pgm.createIndex(LISTS_TABLE, 'updated_at')
  pgm.createFunction(
    FUNCTION_NAME,
    [],
    {
      returns: 'TRIGGER',
      language: 'plpgsql',
      replace: true
    },
    `BEGIN
        NEW.updated_at := NOW();
        RETURN NEW;
    END;`
  )
  pgm.createTrigger(LISTS_TABLE, TRIGGER_NAME, {
    when: 'BEFORE',
    operation: 'UPDATE',
    function: FUNCTION_NAME,
    level: 'ROW'
  })
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTrigger(LISTS_TABLE, TRIGGER_NAME)
  pgm.dropFunction(FUNCTION_NAME, [])
  pgm.dropIndex(LISTS_TABLE, 'updated_at')
  pgm.dropColumn(LISTS_TABLE, 'updated_at')
}
