import SQL, { SQLStatement } from 'sql-template-strings'

export function getWhereStatementFromFilters(filters: (SQLStatement | null)[], isHaving = false): SQLStatement {
  return (
    filters.reduce((acc, filter) => {
      if (filter === null) {
        return acc
      }

      if (acc === null) {
        return SQL` `.append(isHaving ? SQL` HAVING ` : SQL` WHERE `).append(filter)
      }

      return acc.append(SQL` AND `).append(filter)
    }, null) || SQL``
  )
}
