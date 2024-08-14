import SQL from 'sql-template-strings'
import { MARKETPLACE_SQUID_SCHEMA } from '../../../constants'

export function getItemById(itemId: string) {
  return SQL`
        SELECT id
        FROM `.append(MARKETPLACE_SQUID_SCHEMA).append(SQL`.item
        WHERE id = ${itemId};
      `)
}
