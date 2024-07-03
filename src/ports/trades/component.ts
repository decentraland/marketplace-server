import SQL from 'sql-template-strings'
import { TradeCreation } from '@dcl/schemas/dist/dapps/trade'
import { fromDbTradeWithAssetsToTrade } from '../../adapters/trades/trades'
import { validateTradeSignature } from '../../logic/trades/utils'
import { AppComponents } from '../../types'
import {
  InvalidTradeSignatureError,
  TradeAlreadyExpiredError,
  TradeEffectiveAfterExpirationError,
  InvalidTradeStructureError
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
            ...trade.sent.map(asset => ({ ...asset, direction: 'sent' })),
            ...trade.received.map(asset => ({ ...asset, direction: 'received' }))
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
        return fromDbTradeWithAssetsToTrade(insertedTrade.rows[0], assets)
      },
      e => {
        throw new Error(e && typeof e === 'object' && 'message' in e ? (e.message as string) : 'Could not create trade')
      }
    )
  }

  return {
    getTrades,
    addTrade
  }
}
