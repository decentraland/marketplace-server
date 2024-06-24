import SQL from 'sql-template-strings'
import { AppComponents, StatusCode } from '../../types'
import { RequestError } from '../../utils'
import { AddTradeRequestBody, DBTrade, ITradesComponent } from './types'

export function createTradesComponent(components: Pick<AppComponents, 'dappsDatabase'>): ITradesComponent {
  const { dappsDatabase: pg } = components

  async function getTrades() {
    const result = await pg.query<DBTrade>(SQL`SELECT * FROM trades`)
    return { data: result.rows, count: result.rowCount }
  }

  async function addTrade(trade: AddTradeRequestBody, signer: string) {
    // validate expiration > today
    if (trade.checks.expiration < Date.now()) {
      throw new RequestError(StatusCode.BAD_REQUEST, 'Expiration date must be in the future')
    }

    // validate effective < expiration
    if (trade.checks.expiration < trade.checks.effective) {
      throw new RequestError(StatusCode.BAD_REQUEST, 'Trade should be effective before expiration')
    }
    // validate items in sent are owned by the user
    // validate there is no other trade with the same sent items
    // vaidate signature
    const result = await pg.query<DBTrade>(SQL`INSERT INTO trades (id, name) VALUES (1, 'test')`)
    console.log({ result, body, signer })
    return result.rows[0]
  }

  return {
    getTrades,
    addTrade
  }
}
