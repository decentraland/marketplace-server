import { Item } from '@dcl/schemas'

export type TrendingFilters = {
  size?: number
  from?: number
  skip?: number
  first?: number
  pickedBy?: string
}

export interface ITrendingsComponent {
  fetch({ size }: TrendingFilters): Promise<Item[]>
}
export type TrendingSaleDB = {
  search_item_id: string
  search_contract_address: string
}
