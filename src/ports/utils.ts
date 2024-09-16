import SQL, { SQLStatement } from 'sql-template-strings'

export function getWhereStatementFromFilters(filters: (SQLStatement | null)[]): SQLStatement {
  return (
    filters.reduce((acc, filter) => {
      if (filter === null) {
        return acc
      }

      if (acc === null) {
        return SQL` WHERE `.append(filter)
      }

      return acc.append(SQL` AND `).append(filter)
    }, null) || SQL``
  )
}
