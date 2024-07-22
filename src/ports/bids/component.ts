import { fromDBBidToBid } from '../../adapters/bids/bids'
import { AppComponents } from '../../types'
import { getBidsQuery } from './queries'
import { DBBid, GetBidsParameters, IBidsComponent } from './types'

export function createBidsComponents(components: Pick<AppComponents, 'dappsDatabase'>): IBidsComponent {
  const { dappsDatabase: pg } = components

  async function getBids(options: GetBidsParameters) {
    const schema = 'marketplace_squid_20240722_163348' // TODO: fetch schema
    const result = await pg.query<DBBid>(getBidsQuery(options, schema))

    return {
      data: result.rows.map(fromDBBidToBid),
      count: result.rows.length ? Number(result.rows[0].count) : 0
    }
  }

  return {
    getBids
  }
}
