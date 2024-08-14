import SQL from 'sql-template-strings'
import { AppComponents } from '../../types'
import { DBNFT } from './types'

export function createNFTsComponent(components: Pick<AppComponents, 'dappsDatabase' | 'eventPublisher' | 'logs'>): ITradesComponent {
  const { dappsDatabase: pg } = components

  async function getNFTs() {
    const result = await pg.query<DBNFT>(SQL`SELECT * FROM marketplace.trades`)
    return { data: result.rows, count: result.rowCount }
  }

  return {
    getNFTs
  }
}
