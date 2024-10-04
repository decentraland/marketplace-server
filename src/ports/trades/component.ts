import SQL from 'sql-template-strings'
import { Event, TradeAssetDirection, TradeCreation } from '@dcl/schemas'
import { fromDbTradeAndDBTradeAssetWithValueListToTrade } from '../../adapters/trades/trades'
import { isErrorWithMessage } from '../../logic/errors'
import { validateTradeSignature } from '../../logic/trades/utils'
import { AppComponents } from '../../types'
import {
  InvalidTradeSignatureError,
  TradeAlreadyExpiredError,
  TradeEffectiveAfterExpirationError,
  InvalidTradeStructureError,
  InvalidTradeSignerError,
  TradeNotFoundError,
  EventNotGeneratedError,
  TradeNotFoundBySignatureError
} from './errors'
import {
  getInsertTradeAssetQuery,
  getInsertTradeAssetValueByTypeQuery,
  getInsertTradeQuery,
  getTradeAssetsWithValuesByHashedSignatureQuery,
  getTradeAssetsWithValuesByIdQuery
} from './queries'
import { DBTrade, DBTradeAsset, DBTradeAssetValue, DBTradeAssetWithValue, ITradesComponent, TradeEvent } from './types'
import { getNotificationEventForTrade, validateTradeByType } from './utils'

export function createTradesComponent(components: Pick<AppComponents, 'dappsDatabase' | 'eventPublisher' | 'logs'>): ITradesComponent {
  const { dappsDatabase: pg, eventPublisher, logs } = components
  const logger = logs.getLogger('Trades component')

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

    const insertedTrade = await pg.withTransaction(
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

    // trigger notification for trade creation
    try {
      const event = await getNotificationEventForTrade(insertedTrade, pg, TradeEvent.CREATED, signer)
      if (event) {
        const messageId = await eventPublisher.publishMessage(event)
        logger.info(`Notification has been send for trade ${insertedTrade.id} with message id ${messageId}`)
      }
    } catch (e) {
      logger.error(`Could not trigger trade creation event for trade type ${trade.type}`, isErrorWithMessage(e) ? e.message : (e as any))
    }

    return insertedTrade
  }

  async function getTrade(id: string) {
    const result = await pg.query<DBTrade & DBTradeAssetWithValue>(getTradeAssetsWithValuesByIdQuery(id))

    if (!result.rowCount) {
      throw new TradeNotFoundError(id)
    }

    return fromDbTradeAndDBTradeAssetWithValueListToTrade(result.rows[0], result.rows)
  }

  async function getTradeAcceptedEvent(hashedSignature: string, timestamp: number, caller: string): Promise<Event> {
    const result = await pg.query<DBTrade & DBTradeAssetWithValue>(getTradeAssetsWithValuesByHashedSignatureQuery(hashedSignature))

    if (!result.rowCount) {
      throw new TradeNotFoundBySignatureError(hashedSignature)
    }

    const trade = fromDbTradeAndDBTradeAssetWithValueListToTrade(result.rows[0], result.rows)
    const event = await getNotificationEventForTrade(trade, pg, TradeEvent.ACCEPTED, caller)

    if (!event) {
      throw new EventNotGeneratedError()
    }

    return {
      ...event,
      timestamp
    }
  }

  return {
    getTrades,
    addTrade,
    getTrade,
    getTradeAcceptedEvent
  }
}
