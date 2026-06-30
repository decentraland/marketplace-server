import SQL from 'sql-template-strings'
import { Event, Trade, TradeAssetDirection, TradeAssetType, TradeCreation, TradeType } from '@dcl/schemas'
import { ContractName, getContract } from 'decentraland-transactions'
import { fromDbTradeAndDBTradeAssetWithValueListToTrade } from '../../adapters/trades/trades'
import { isErrorWithMessage } from '../../logic/errors'
import { recreateTradesMaterializedView } from '../../logic/trades/materialized-view'
import { validateAssetOwnership, validateTradeSignature } from '../../logic/trades/utils'
import { AppComponents } from '../../types'
import { IPgComponent } from '../db/types'
import {
  InvalidTradeSignatureError,
  TradeAlreadyExpiredError,
  TradeEffectiveAfterExpirationError,
  InvalidTradeStructureError,
  InvalidTradeSignerError,
  TradeNotFoundError,
  EventNotGeneratedError,
  TradeNotFoundBySignatureError,
  InvalidOwnerError,
  InvalidEstateTrade
} from './errors'
import {
  getInsertTradeAssetQuery,
  getInsertTradeAssetValueByTypeQuery,
  getInsertTradeQuery,
  getTradeAssetsWithValuesByHashedSignatureQuery,
  getTradeAssetsWithValuesByIdQuery,
  getTradesByAddressQuery
} from './queries'
import { DBTrade, DBTradeAsset, DBTradeAssetValue, DBTradeAssetWithValue, ITradesComponent, TradeEvent } from './types'
import { getNotificationEventForTrade, isERC721TradeAsset, isEstateChain, isValidEstateTrade, validateTradeByType } from './utils'

type TradeWithAssetRow = {
  trade_id: string
  trade_chain_id: number
  trade_checks: DBTrade['checks']
  trade_created_at: Date
  trade_effective_since: Date
  trade_expires_at: Date
  trade_network: string
  trade_signature: string
  trade_signer: string
  trade_type: TradeType
  trade_contract: string
  asset_id: string
  asset_type: TradeAssetType
  asset_beneficiary: string | null
  asset_contract_address: string
  asset_direction: TradeAssetDirection
  asset_extra: string
  asset_trade_id: string
  asset_created_at: Date
  token_id: string | null
  amount: string | null
  item_id: string | null
}

export function createTradesComponent(
  components: Pick<AppComponents, 'dappsDatabase' | 'eventPublisher' | 'logs'> & { dappsReadDatabase?: IPgComponent }
): ITradesComponent {
  const { dappsDatabase: pg, dappsReadDatabase, eventPublisher, logs } = components
  // Route read-only validation + notification queries to the read replica when one is wired, keeping
  // the write primary for the insert transaction. Falls back to the write DB if no replica is given.
  const readPg = dappsReadDatabase ?? pg
  const logger = logs.getLogger('Trades component')

  async function getTrades() {
    const result = await pg.query<DBTrade>(SQL`SELECT * FROM marketplace.trades`)
    return { data: result.rows, count: result.rowCount }
  }

  async function getTradesByAddress(address: string, options: { limit?: number; offset?: number } = {}) {
    const limit = options.limit ?? 100
    const result = await pg.query<TradeWithAssetRow>(getTradesByAddressQuery(address, { limit, offset: options.offset }))

    const grouped = new Map<string, TradeWithAssetRow[]>()
    for (const row of result.rows) {
      const existing = grouped.get(row.trade_id)
      if (existing) {
        existing.push(row)
      } else {
        grouped.set(row.trade_id, [row])
      }
    }

    const trades: Trade[] = []
    for (const rows of grouped.values()) {
      const head = rows[0]
      const dbTrade: DBTrade = {
        id: head.trade_id,
        chain_id: head.trade_chain_id,
        checks: head.trade_checks,
        created_at: head.trade_created_at,
        effective_since: head.trade_effective_since,
        expires_at: head.trade_expires_at,
        network: head.trade_network,
        signature: head.trade_signature,
        signer: head.trade_signer,
        type: head.trade_type,
        contract: head.trade_contract
      }
      const assets = rows.map(toDBTradeAssetWithValue).filter((a): a is DBTradeAssetWithValue => a !== null)
      trades.push(fromDbTradeAndDBTradeAssetWithValueListToTrade(dbTrade, assets))
    }

    return { data: trades }
  }

  function toDBTradeAssetWithValue(r: TradeWithAssetRow): DBTradeAssetWithValue | null {
    const base = {
      id: r.asset_id,
      beneficiary: r.asset_beneficiary ?? undefined,
      contract_address: r.asset_contract_address,
      direction: r.asset_direction,
      extra: r.asset_extra,
      trade_id: r.asset_trade_id,
      created_at: r.asset_created_at
    }
    switch (r.asset_type) {
      case TradeAssetType.ERC20:
        if (r.amount === null) {
          logger.warn(`Trade asset ${r.asset_id} declared ERC20 but missing amount; dropping from trade ${r.asset_trade_id}`)
          return null
        }
        return { ...base, asset_type: TradeAssetType.ERC20, amount: r.amount }
      case TradeAssetType.USD_PEGGED_MANA:
        if (r.amount === null) {
          logger.warn(`Trade asset ${r.asset_id} declared USD_PEGGED_MANA but missing amount; dropping from trade ${r.asset_trade_id}`)
          return null
        }
        return { ...base, asset_type: TradeAssetType.USD_PEGGED_MANA, amount: r.amount }
      case TradeAssetType.ERC721:
        if (r.token_id === null) {
          logger.warn(`Trade asset ${r.asset_id} declared ERC721 but missing token_id; dropping from trade ${r.asset_trade_id}`)
          return null
        }
        return { ...base, asset_type: TradeAssetType.ERC721, token_id: r.token_id }
      case TradeAssetType.COLLECTION_ITEM:
        if (r.item_id === null) {
          logger.warn(`Trade asset ${r.asset_id} declared COLLECTION_ITEM but missing item_id; dropping from trade ${r.asset_trade_id}`)
          return null
        }
        return { ...base, asset_type: TradeAssetType.COLLECTION_ITEM, item_id: r.item_id }
      default:
        logger.warn(`Trade asset ${r.asset_id} has unsupported asset_type ${r.asset_type}; dropping from trade ${r.asset_trade_id}`)
        return null
    }
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

    // validate signature length (0x + 130 hex chars for a standard ECDSA signature)
    if (trade.signature.length !== 132) {
      throw new InvalidTradeSignatureError()
    }

    // Validate the signature BEFORE any I/O: it is cheap (CPU only) and short-circuiting here avoids
    // running DB queries / on-chain RPC calls on behalf of forged or unsigned requests.
    if (!validateTradeSignature(trade, signer)) {
      throw new InvalidTradeSignatureError()
    }

    // The remaining validations are independent and I/O-bound (DB query + on-chain RPC calls). Run
    // them concurrently instead of serially so the validation latency is the max of the checks
    // rather than their sum. We then surface the first failure in a FIXED precedence
    // (structure → estate → ownership) so the error returned to the client is deterministic and does
    // not depend on which check happens to settle first.
    const validations = await Promise.allSettled([
      (async () => {
        // validate trade type / structure (read-only duplicate check → read replica)
        if (!(await validateTradeByType(trade, readPg))) {
          throw new InvalidTradeStructureError(trade.type)
        }
      })(),
      (async () => {
        // validate the estate fingerprint (estate chains only)
        if (isEstateChain(trade.chainId) && !(await isValidEstateTrade(trade))) {
          throw new InvalidEstateTrade()
        }
      })(),
      (async () => {
        // validate ownership of the sent asset (ERC721 sent assets only)
        if (isERC721TradeAsset(trade.sent[0]) && !(await validateAssetOwnership(trade.sent[0], signer, trade.chainId))) {
          throw new InvalidOwnerError()
        }
      })()
    ])

    const failedValidation = validations.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failedValidation) {
      throw failedValidation.reason
    }

    const tradeContract = getContract(ContractName.OffChainMarketplaceV2, trade.chainId)

    const insertedTrade = await pg.withTransaction(
      async client => {
        const query = getInsertTradeQuery({ ...trade, contract: tradeContract.address }, signer)
        const insertedTrade = await client.query<DBTrade>(query)
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

    // Fire-and-forget the creation notification. It is best-effort (failures are swallowed) and must
    // not add the asset lookups + SNS publish round-trip to the user-perceived latency: the trade is
    // already durably persisted, so return it immediately.
    void notifyTradeCreated(insertedTrade, signer)

    return insertedTrade
  }

  async function notifyTradeCreated(insertedTrade: Trade, signer: string) {
    try {
      // read-only asset lookups for the notification → read replica
      const event = await getNotificationEventForTrade(insertedTrade, readPg, TradeEvent.CREATED, signer)
      if (event) {
        const messageId = await eventPublisher.publishMessage(event)
        logger.info(`Notification has been send for trade ${insertedTrade.id} with message id ${messageId}`)
      }
    } catch (e) {
      logger.error(
        `Could not trigger trade creation event for trade type ${insertedTrade.type}`,
        isErrorWithMessage(e) ? e.message : (e as any)
      )
    }
  }

  async function getTrade(id: string) {
    const query = getTradeAssetsWithValuesByIdQuery(id)
    const result = await pg.query<DBTrade & DBTradeAssetWithValue>(query)

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

  async function recreateMaterializedView() {
    await recreateTradesMaterializedView(pg)
  }

  return {
    getTrades,
    getTradesByAddress,
    addTrade,
    getTrade,
    getTradeAcceptedEvent,
    recreateMaterializedView
  }
}
