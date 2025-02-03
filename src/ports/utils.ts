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

/**
 * Formats a SQL query into a single line for logging purposes
 * @param query The SQL query text
 * @returns The formatted query in a single line
 */
export function formatQueryForLogging(query: string): string {
  return query
    .replace(/\s+/g, ' ') // Replace multiple spaces/newlines with single space
    .replace(/\( /g, '(') // Remove space after opening parenthesis
    .replace(/ \)/g, ')') // Remove space before closing parenthesis
    .replace(/ ,/g, ',') // Remove space before comma
    .trim()
}
