export type TPick = {
  itemId: string
  userAddress: string
  listId: string
  createdAt: number
}

export type PickUserAddressesWithCount = {
  picks: Pick<TPick, 'userAddress'>[]
  count: number
}
