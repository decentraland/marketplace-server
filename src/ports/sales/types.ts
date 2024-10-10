import { Network, NFTCategory, Sale, SaleFilters, SaleType } from '@dcl/schemas'
import { SquidNetwork } from '../../types'

export interface ISalesComponent {
  getSales(filters: SaleFilters): Promise<GetSalesResponse>
}

export type GetSalesResponse = {
  data: Sale[]
  total: number
}

export type DBSale = {
  count: number
  id: string
  type: SaleType
  buyer: string
  seller: string
  item_id: string
  token_id: string
  contract_address: string
  price: string
  timestamp: string
  tx_hash: string
  network: SquidNetwork | Network.MATIC | Network.ETHEREUM
  category: NFTCategory
}
