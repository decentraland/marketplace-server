import { Item } from '@dcl/schemas'
import { TrendingSaleDB } from './types'

export function fromTrendingSaleFragment(fragment: TrendingSaleDB) {
  return {
    itemId: fragment.search_item_id,
    contractAddress: fragment.search_contract_address
  }
}

export function findItemByItemId(items: Item[], id: string) {
  const [contractAddress, itemId] = id.split('-')
  return items.find(item => contractAddress === item.contractAddress && itemId === item.itemId)
}

export function getDateXDaysAgo(numOfDays: number, date = new Date()) {
  const daysAgo = new Date(date.getTime())

  daysAgo.setDate(date.getDate() - numOfDays)
  daysAgo.setHours(0)
  daysAgo.setMinutes(0)
  daysAgo.setSeconds(0)

  return daysAgo
}
