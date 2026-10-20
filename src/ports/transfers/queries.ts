import SQL, { SQLStatement } from 'sql-template-strings'
import { MARKETPLACE_SQUID_SCHEMA } from '../../constants'
import { TransferFilters } from './types'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const MAX_LIMIT = 500

// On Ethereum the squid ids a wearable's transfers as `wearable-<contract>-<token>`, while its nft and sale rows use
// `<contract>-<token>`. Every other NFT uses the same id everywhere.
const NFT_KEY = SQL`(CASE WHEN tf.nft_id LIKE 'wearable-%' THEN substr(tf.nft_id, 10) ELSE tf.nft_id END)`

// A sale also moves the NFT, and both sides already see it as a sale. Executed trades write their sale row too.
function notASale(): SQLStatement {
  return SQL` AND NOT EXISTS (SELECT 1 FROM `
    .append(MARKETPLACE_SQUID_SCHEMA)
    .append(SQL`.sale s WHERE s.nft_id = `)
    .append(NFT_KEY)
    .append(SQL` AND s.tx_hash = tf.tx_hash)`)
}

// Each side is limited on its own so both can use their address index before the union is sorted.
function side(column: 'from' | 'to', address: string, first: number): SQLStatement {
  const query = SQL`(SELECT tf.*, `
    .append(NFT_KEY)
    .append(SQL` AS nft_key FROM `)
    .append(MARKETPLACE_SQUID_SCHEMA)
    .append(SQL`.transfer tf WHERE `)
  if (column === 'from') {
    query.append(SQL`tf."from" = ${address} AND tf."to" <> ${address}`)
  } else {
    query.append(SQL`tf."to" = ${address} AND tf."from" <> ${ZERO_ADDRESS} AND tf."from" <> ${address}`)
  }
  return query.append(notASale()).append(SQL` ORDER BY tf.timestamp DESC, tf.id LIMIT ${first})`)
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
    .append(SQL`.nft n ON n.id = t.nft_key ORDER BY t.timestamp DESC, t.id LIMIT ${first}`)
}
