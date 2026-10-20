import { fromDBTransferToTransfer } from '../../adapters/transfers'
import { AppComponents } from '../../types'
import { getTransfersQuery } from './queries'
import { DBTransfer, ITransfersComponent, TransferFilters } from './types'

export function createTransfersComponent(components: Pick<AppComponents, 'dappsDatabase'>): ITransfersComponent {
  const { dappsDatabase: database } = components

  async function getTransfers(filters: TransferFilters) {
    const result = await database.query<DBTransfer>(getTransfersQuery(filters))
    return result.rows.map(fromDBTransferToTransfer)
  }

  return { getTransfers }
}
