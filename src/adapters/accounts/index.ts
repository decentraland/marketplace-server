import { Account, DBAccount } from '../../ports/accounts/types'

export function fromDBAccountToAccount(dbAccount: DBAccount): Account {
  return {
    id: dbAccount.id,
    address: dbAccount.address,
    sales: dbAccount.sales,
    purchases: dbAccount.purchases,
    spent: dbAccount.spent,
    earned: dbAccount.earned,
    royalties: dbAccount.royalties,
    collections: dbAccount.collections
  }
}
