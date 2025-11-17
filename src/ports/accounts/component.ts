import { fromDBAccountToAccount } from '../../adapters/accounts'
import { AppComponents } from '../../types'
import { getAccountsCountQuery, getAccountsQuery } from './queries'
import { AccountFilters, DBAccount, IAccountsComponent } from './types'

/**
 * Creates the Accounts component
 *
 * Orchestrates account data retrieval operations:
 * 1. Queries the database for account information
 * 2. Applies filtering, sorting, and pagination
 * 3. Maps database records to Account schema format
 *
 * @param components Required components: dappsDatabase
 * @returns IAccountsComponent implementation
 */
export function createAccountsComponent(components: Pick<AppComponents, 'dappsDatabase'>): IAccountsComponent {
  const { dappsDatabase: pg } = components

  /**
   * Retrieves accounts based on provided filters
   *
   * This method queries the database for account records and returns paginated results
   * with the total count. All queries are executed in parallel for performance.
   *
   * @param filters - Optional filters for querying accounts (pagination, sorting, address, network)
   * @returns Promise resolving to an object containing the account data array and total count
   */
  async function getAccounts(filters: AccountFilters = {}) {
    const [accounts, count] = await Promise.all([
      pg.query<DBAccount>(getAccountsQuery(filters)),
      pg.query<{ count: string }>(getAccountsCountQuery(filters))
    ])
    return { data: accounts.rows.map(fromDBAccountToAccount), total: Number(count.rows[0].count) ?? 0 }
  }

  return {
    getAccounts
  }
}
