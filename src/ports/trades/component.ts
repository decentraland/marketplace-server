import SQL from 'sql-template-strings'
import { Trade } from '@dcl/schemas'
import { fromSecondsToMilliseconds } from '../../logic/date'
import { validateTradeByType, validateTradeSignature } from '../../logic/trades/utils'
import { AppComponents, StatusCode } from '../../types'
import { RequestError } from '../../utils'
import { DBTrade, ITradesComponent } from './types'

export function createTradesComponent(components: Pick<AppComponents, 'dappsDatabase'>): ITradesComponent {
  const { dappsDatabase: pg } = components

  async function getTrades() {
    const result = await pg.query<DBTrade>(SQL`SELECT * FROM marketplace.trades`)
    return { data: result.rows, count: result.rowCount }
  }

  async function addTrade(trade: Trade, signer: string) {
    // validate expiration > today
    if (trade.checks.expiration < Date.now()) {
      throw new RequestError(StatusCode.BAD_REQUEST, 'Expiration date must be in the future')
    }

    // validate effective < expiration
    if (trade.checks.expiration < trade.checks.effective) {
      throw new RequestError(StatusCode.BAD_REQUEST, 'Trade should be effective before expiration')
    }

    // validate trade type
    if (!validateTradeByType(trade)) {
      throw new RequestError(StatusCode.BAD_REQUEST, `Trade structure is not valid for type ${trade.type}`)
    }

    // TODO: validate items in sent are owned by the user
    // vaidate signature
    if (!validateTradeSignature(trade, signer)) {
      throw new RequestError(StatusCode.BAD_REQUEST, 'Invalid signature')
    }

    const client = await pg.getPool().connect()
    try {
      await client.query(SQL`BEGIN`)
      const intsertedTrade = await pg.query<DBTrade>(
        SQL`INSERT INTO trades (
          chainId,
          checks,
          effectiveSince,
          expiresAt,
          network,
          signature,
          signer,
          type
        ) VALUES (
         ${trade.chainId},
         ${trade.checks},
         ${new Date(fromSecondsToMilliseconds(trade.checks.effective))},
         ${new Date(fromSecondsToMilliseconds(trade.checks.expiration))},
         ${trade.network},
         ${trade.signature},
         ${signer},
         ${trade.type}
         ) RETURNING *`
      )

      trade.sent.forEach(async asset => {
        await pg.query(SQL`INSERT INTO trade_assets (
          asset_type,
          contract_address,
          direction,
          extra,
          trade_id,
          value,
          ) VALUES (
            ${asset.assetType},
            ${asset.contractAddress},
            'sent',
            ${asset.extra},
            ${intsertedTrade.rows[0].id},
            ${asset.value}
          )`)
      })

      trade.received.forEach(async asset => {
        await pg.query(SQL`INSERT INTO trade_assets (
          asset_type,
          beneficiary,
          contract_address,
          direction,
          extra,
          trade_id,
          value,
          ) VALUES (
            ${asset.assetType},
            ${asset.beneficiary},
            ${asset.contractAddress},
            'received',
            ${asset.extra},
            ${intsertedTrade.rows[0].id},
            ${asset.value}
          )`)
      })

      await client.query(SQL`COMMIT`)
    } catch (e) {
      await client.query(SQL`ROLLBACK`)
    }

    return result.rows[0]
  }

  return {
    getTrades,
    addTrade
  }
}
