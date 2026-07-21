import SQL from 'sql-template-strings'
import { Event, Trade, TradeAsset, TradeAssetDirection, TradeAssetType, TradeCreation, TradeType } from '@dcl/schemas'
import { ContractName, getContract } from 'decentraland-transactions'
import { fromDbTradeAndDBTradeAssetWithValueListToTrade } from '../../adapters/trades/trades'
import { isErrorWithMessage } from '../../logic/errors'
import { recreateTradesMaterializedView } from '../../logic/trades/materialized-view'
import { validateAssetOwnership, validateTradeSignature } from '../../logic/trades/utils'
import { AppComponents } from '../../types'
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
  getItemIdByTokenIdQuery,
  getOtherOpenListingForItemQuery,
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
  components: Pick<AppComponents, 'dappsDatabase' | 'eventPublisher' | 'logs' | 'shopNotifier'>
): ITradesComponent {
  const { dappsDatabase: pg, eventPublisher, logs, shopNotifier } = components
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

    // validate trade type
    if (!(await validateTradeByType(trade, pg))) {
      throw new InvalidTradeStructureError(trade.type)
    }
    // Validate if estate trade is correct
    if (isEstateChain(trade.chainId) && !(await isValidEstateTrade(trade))) {
      throw new InvalidEstateTrade()
    }

    // validate signature length (0x + 130 hex chars for a standard ECDSA signature)
    if (trade.signature.length !== 132) {
      throw new InvalidTradeSignatureError()
    }

    // validate signature
    if (!validateTradeSignature(trade, signer)) {
      throw new InvalidTradeSignatureError()
    }

    // validate right ownership
    if (isERC721TradeAsset(trade.sent[0]) && !(await validateAssetOwnership(trade.sent[0], signer, trade.chainId))) {
      throw new InvalidOwnerError()
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

    // Best-effort, fire-and-forget: tell the Shop waitlist when this listing makes the item go on sale.
    // The trade is already persisted, so we deliberately do NOT await — the ping (a couple of queries +
    // up to a 2s HTTP timeout) must not delay the trade response. Errors are swallowed here and inside
    // the notifier, so it can never affect trade creation.
    void notifyShopIfItemGoesOnSale(insertedTrade).catch(e =>
      logger.error(`Could not notify shop waitlist for trade ${insertedTrade.id}`, isErrorWithMessage(e) ? e.message : (e as any))
    )

    return insertedTrade
  }

  // Notifies the Shop that an item transitioned from not-for-sale to on-sale, so it can email its
  // waitlist. Only listings qualify (primary re-list via PUBLIC_ITEM_ORDER or secondary via
  // PUBLIC_NFT_ORDER); bids and everything else return early. Skips when the item already had another
  // open listing (it was already on sale) and when the item id cannot be resolved (never guesses).
  async function notifyShopIfItemGoesOnSale(trade: Trade): Promise<void> {
    if (trade.type !== TradeType.PUBLIC_ITEM_ORDER && trade.type !== TradeType.PUBLIC_NFT_ORDER) {
      return
    }

    const sentAsset: TradeAsset | undefined = trade.sent[0]
    if (!sentAsset) {
      return
    }
    const contractAddress = sentAsset.contractAddress

    // Resolve the item id of the asset being listed.
    let itemId: string | undefined
    if (sentAsset.assetType === TradeAssetType.COLLECTION_ITEM) {
      // Primary re-list: the sold asset is the collection item itself, so its item id is direct.
      itemId = sentAsset.itemId
    } else if (sentAsset.assetType === TradeAssetType.ERC721) {
      // Secondary listing: the sold asset is an ERC721 token; resolve it to the item id it was minted
      // from via the squid `nft` table (same contract_address + token_id join the trade queries use).
      const result = await pg.query<{ item_id: string | null }>(getItemIdByTokenIdQuery(contractAddress, sentAsset.tokenId))
      itemId = result.rows[0]?.item_id ?? undefined
    }

    // Can't resolve an item id -> skip rather than guess.
    if (!itemId) {
      return
    }

    // Transition check: only ping on a real not-for-sale -> on-sale change. If any OTHER open listing of
    // the same item already exists, the item was already on sale, so skip.
    const otherOpen = await pg.query(getOtherOpenListingForItemQuery(contractAddress, itemId, trade.id))
    if (otherOpen.rowCount && otherOpen.rowCount > 0) {
      return
    }

    await shopNotifier.notifyItemOnSale({ contractAddress, itemId })
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
