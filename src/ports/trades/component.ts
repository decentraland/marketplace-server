import SQL from 'sql-template-strings'
import { TradeAssetDirection, TradeCreation } from '@dcl/schemas/dist/dapps/trade'
import { fromDbTradeAndDBTradeAssetWithValueListToTrade } from '../../adapters/trades/trades'
import { isErrorWithMessage } from '../../logic/errors'
import { validateTradeSignature } from '../../logic/trades/utils'
import { AppComponents } from '../../types'
import {
  InvalidTradeSignatureError,
  TradeAlreadyExpiredError,
  TradeEffectiveAfterExpirationError,
  InvalidTradeStructureError,
  InvalidTradeSignerError
} from './errors'
import { getInsertTradeAssetQuery, getInsertTradeAssetValueByTypeQuery, getInsertTradeQuery } from './queries'
import { DBTrade, DBTradeAsset, DBTradeAssetValue, ITradesComponent } from './types'
import { validateTradeByType } from './utils'

export function createTradesComponent(components: Pick<AppComponents, 'dappsDatabase'>): ITradesComponent {
  const { dappsDatabase: pg } = components

  async function getTrades() {
    const result = await pg.query<DBTrade>(SQL`SELECT * FROM marketplace.trades`)
    return { data: result.rows, count: result.rowCount }
  }

  async function addTrade(trade: TradeCreation, signer: string) {
    // validate expiration > today
    if (trade.checks.expiration < Date.now()) {
      throw new TradeAlreadyExpiredError()
    }

    // validate effective < expiration
    if (trade.checks.expiration < trade.checks.effective) {
      throw new TradeEffectiveAfterExpirationError()
    }

    if (trade.signer.toLowerCase() !== signer.toLowerCase()) {
      throw new InvalidTradeSignerError()
    }

    // validate trade type
    if (!(await validateTradeByType(trade, pg))) {
      throw new InvalidTradeStructureError(trade.type)
    }

    // vaidate signature
    if (!validateTradeSignature(trade, signer)) {
      throw new InvalidTradeSignatureError()
    }

    return pg.withTransaction(
      async client => {
        const insertedTrade = await client.query<DBTrade>(getInsertTradeQuery(trade, signer))
        const assets = await Promise.all(
          [
            ...trade.sent.map(asset => ({ ...asset, direction: TradeAssetDirection.SENT })),
            ...trade.received.map(asset => ({ ...asset, direction: TradeAssetDirection.RECEIVED }))
          ].map(async asset => {
            const insertedAsset = await client.query<DBTradeAsset>(
              getInsertTradeAssetQuery(asset, insertedTrade.rows[0].id, asset.direction)
            )
            const insertedValue = await client.query<DBTradeAssetValue>(
              getInsertTradeAssetValueByTypeQuery(asset, insertedAsset.rows[0].id)
            )
            return { ...insertedAsset.rows[0], ...insertedValue.rows[0] }
          })
        )
        return fromDbTradeAndDBTradeAssetWithValueListToTrade(insertedTrade.rows[0], assets)
      },
      e => {
        throw new Error(isErrorWithMessage(e) ? e.message : 'Could not create trade')
      }
    )
  }

  return {
    getTrades,
    addTrade
  }
}
