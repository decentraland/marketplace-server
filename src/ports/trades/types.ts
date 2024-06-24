export type ITradesComponent = {
  getTrades(): Promise<{ data: DBTrade[]; count: number }>
}

export type DBTrade = {
  signer: string
  id: string
  checks: Record<string, any>
  signature: string
}
