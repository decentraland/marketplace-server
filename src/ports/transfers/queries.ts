import SQL, { SQLStatement } from 'sql-template-strings'
import { MARKETPLACE_SQUID_SCHEMA, TRADES_SQUID_SCHEMA } from '../../constants'
import { TransferFilters } from './types'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const MAX_LIMIT = 500

// A sale or an executed trade also moves the NFT, but the buyer and the seller already see it as a sale.
function notASettlement(): SQLStatement {
  return SQL` AND NOT EXISTS (SELECT 1 FROM `
    .append(MARKETPLACE_SQUID_SCHEMA)
    .append(SQL`.sale s WHERE s.nft_id = tf.nft_id AND s.tx_hash = tf.tx_hash)`)
    .append(SQL` AND NOT EXISTS (SELECT 1 FROM `)
    .append(TRADES_SQUID_SCHEMA)
    .append(SQL`.trade tr WHERE tr.tx_hash = tf.tx_hash)`)
}

// Each side is limited on its own so both can use their address index before the union is sorted.
function side(column: 'from' | 'to', address: string, first: number): SQLStatement {
  const query = SQL`(SELECT tf.* FROM `.append(MARKETPLACE_SQUID_SCHEMA).append(SQL`.transfer tf WHERE `)
  if (column === 'from') {
    query.append(SQL`tf."from" = ${address} AND tf."to" <> ${address}`)
  } else {
    query.append(SQL`tf."to" = ${address} AND tf."from" <> ${ZERO_ADDRESS} AND tf."from" <> ${address}`)
  }
  return query.append(notASettlement()).append(SQL` ORDER BY tf.timestamp DESC, tf.id LIMIT ${first})`)
}

export function getTransfersQuery(filters: TransferFilters): SQLStatement {
  const address = filters.address.toLowerCase()
  const first = Math.min(filters.first, MAX_LIMIT)
  return SQL`
    SELECT
      t.id,
      t."from",
      t."to",
      t.tx_hash,
      (t.timestamp * 1000) AS timestamp,
      t.network,
      n.contract_address,
      n.token_id::text AS token_id,
      n.item_blockchain_id::text AS item_id,
      n.category
    FROM (`
    .append(side('from', address, first))
    .append(SQL` UNION ALL `)
    .append(side('to', address, first))
    .append(SQL`) t JOIN `)
    .append(MARKETPLACE_SQUID_SCHEMA)
    .append(SQL`.nft n ON n.id = t.nft_id ORDER BY t.timestamp DESC, t.id LIMIT ${first}`)
}
