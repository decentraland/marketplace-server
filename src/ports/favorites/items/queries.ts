import SQL from 'sql-template-strings'

export function getItemById(schema: string, itemId: string) {
  return SQL`
        SELECT id
        FROM `.append(schema).append(SQL`.items
        WHERE id = ${itemId};
      `)
}
