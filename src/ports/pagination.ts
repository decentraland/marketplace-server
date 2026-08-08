import SQL, { SQLStatement } from 'sql-template-strings'

export type PaginationParams = {
  first?: number
  skip?: number
}

export function getLimitAndOffsetStatement(params: PaginationParams, options?: { defaultLimit?: number; maxLimit?: number }): SQLStatement {
  const { defaultLimit = 1000, maxLimit } = options ?? {}
  const limit = params.first ? (maxLimit ? Math.min(params.first, maxLimit) : params.first) : defaultLimit
  const offset = params.skip ?? 0

  return SQL` LIMIT ${limit} OFFSET ${offset} `
}

export function extractCount(result: { rows: { count: string }[] }): number {
  return Number(result.rows?.[0]?.count ?? 0)
}
