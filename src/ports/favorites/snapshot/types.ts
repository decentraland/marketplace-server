export type ScoreRequest = {
  jsonrpc: '2.0'
  method: 'get_vp'
  params: {
    address: string
    network: string
    strategies: unknown[]
    snapshot?: number
    space: string
    delegation: boolean
  }
}

export type ScoreResponse = {
  jsonrpc: '2.0'
  result: {
    vp: number
    vp_by_strategy: number
    vp_state: string
  }
}

export interface ISnapshotComponent {
  getScore(address: string): Promise<number>
}
