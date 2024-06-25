import SQL from 'sql-template-strings'
import { AppComponents } from '../../types'
import { DBTrade, ITradesComponent } from './types'

export function createTradesComponent(components: Pick<AppComponents, 'dappsDatabase'>): ITradesComponent {
  const { dappsDatabase: pg } = components

  async function getTrades() {
    const result = await pg.query<DBTrade>(SQL`SELECT * FROM marketplace.trades`)
    return { data: result.rows, count: result.rowCount }
  }

  return {
    getTrades
  }
}
