export type PaginatedResponse<T> = {
  results: T[]
  total: number
  page: number
  pages: number
  limit: number
}

export type PaginationParameters = {
  offset: number
  limit: number
}
