import { AppComponents } from '../../types'
import { getContractBumpCancelledTradesQuery } from './queries'
import { CancelledTradesFilters, CancelledTradesPage, DBCancelledTrade, ICancelledTradesComponent } from './types'

/**
 * Lists a signer's cancelled trades for a given reason, computed from the trades indexer's event history.
 *
 * @param components - The dapps database, which also holds the indexers' schemas.
 * @returns The cancelled trades component.
 */
export function createCancelledTradesComponent(components: Pick<AppComponents, 'dappsDatabase'>): ICancelledTradesComponent {
  const { dappsDatabase: database } = components

  async function getCancelledTrades(filters: CancelledTradesFilters): Promise<CancelledTradesPage> {
    const result = await database.query<DBCancelledTrade>(getContractBumpCancelledTradesQuery(filters))
    // Always one row at least: the total. A page with no trades on it carries it on a row with no trade.
    const first = result.rows[0]
    return {
      data: result.rows
        .filter((row): row is DBCancelledTrade & { id: string } => row.id !== null)
        .map(row => ({
          id: row.id,
          type: row.type,
          network: row.network,
          chainId: row.chain_id,
          contract: row.contract.toLowerCase(),
          reason: filters.reason,
          createdAt: row.created_at.getTime(),
          expiresAt: row.expires_at.getTime(),
          cancelledAt: Number(row.cancelled_at),
          asset: {
            contractAddress: row.asset_contract,
            tokenId: row.token_id,
            itemId: row.item_id,
            name: row.name,
            image: row.image
          },
          price:
            row.price_asset_type !== null && row.price_amount !== null
              ? { assetType: row.price_asset_type, amount: row.price_amount }
              : null
        })),
      total: first ? Number(first.total) : 0
    }
  }

  return { getCancelledTrades }
}
