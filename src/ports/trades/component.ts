import SQL from 'sql-template-strings'
import { TradeCreation } from '@dcl/schemas/dist/dapps/trade'
import { fromDbTradeWithAssetsToTrade } from '../../adapters/trades/trades'
import { validateTradeSignature } from '../../logic/trades/utils'
import { AppComponents, StatusCode } from '../../types'
import { RequestError } from '../../utils'
import { getInsertTradeAssetQuery, getInsertTradeAssetWithBeneficiaryQuery, getInsertTradeQuery } from './queries'
import { DBTrade, DBTradeAsset, ITradesComponent } from './types'
import { validateTradeByType } from './utils'

export function createTradesComponent(components: Pick<AppComponents, 'dappsDatabase'>): ITradesComponent {
  const { dappsDatabase: pg } = components

  async function getTrades() {
    const result = await pg.query<DBTrade>(SQL`SELECT * FROM marketplace.trades`)
    return { data: result.rows, count: result.rowCount }
  }

  async function addTrade(trade: TradeCreation, signer: string) {
    const pgClient = await pg.getPool().connect()

    // validate expiration > today
    if (trade.checks.expiration < Date.now()) {
      throw new RequestError(StatusCode.BAD_REQUEST, 'Expiration date must be in the future')
    }

    // validate effective < expiration
    if (trade.checks.expiration < trade.checks.effective) {
      throw new RequestError(StatusCode.BAD_REQUEST, 'Trade should be effective before expiration')
    }

    // validate trade type
    if (!(await validateTradeByType(trade, pgClient))) {
      throw new RequestError(StatusCode.BAD_REQUEST, `Trade structure is not valid for type ${trade.type}`)
    }

    // vaidate signature
    if (!validateTradeSignature(trade, signer)) {
      throw new RequestError(StatusCode.BAD_REQUEST, 'Invalid signature')
    }

    return pg.withTransaction(
      async client => {
        const insertedTrade = await client.query<DBTrade>(getInsertTradeQuery(trade, signer))
        const sentAssets = (
          await Promise.all(
            trade.received.map(async asset => await client.query<DBTradeAsset>(getInsertTradeAssetQuery(asset, insertedTrade.rows[0].id)))
          )
        ).map(({ rows }) => rows[0])

        const receivedAssets = (
          await Promise.all(
            trade.received.map(
              async asset => await client.query<DBTradeAsset>(getInsertTradeAssetWithBeneficiaryQuery(asset, insertedTrade.rows[0].id))
            )
          )
        ).map(({ rows }) => rows[0])
        return fromDbTradeWithAssetsToTrade(insertedTrade.rows[0], sentAssets, receivedAssets)
      },
      e => {
        throw new RequestError(
          StatusCode.ERROR,
          e && typeof e === 'object' && 'message' in e ? (e.message as string) : 'Could not create trade'
        )
      }
    )
  }

  return {
    getTrades,
    addTrade
  }
}
