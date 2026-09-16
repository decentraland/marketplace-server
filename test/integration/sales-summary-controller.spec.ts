import SQL from 'sql-template-strings'
import { test } from '../components'
import { createSquidDBItem, deleteSquidDBItem } from './utils/dbItems'

test('sales summary', ({ components }) => {
  const seller = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  const other = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  const contract = '0xcccccccccccccccccccccccccccccccccccccccc'
  const secondContract = '0xdddddddddddddddddddddddddddddddddddddddd'
  const price = '900719925474099312345'
  const empty = {
    total: 0,
    mints: 0,
    resales: 0,
    earnedWei: '0',
    byCollection: [],
    byItem: [],
    royalties: { resales: 0, volumeWei: '0' }
  }

  async function addSale(id: string, type: string, owner: string, timestamp: number, address = contract, itemId = '0') {
    await components.dappsDatabase.query(SQL`
      INSERT INTO squid_marketplace.sale
        (id, type, buyer, seller, price, timestamp, tx_hash, search_token_id,
         search_contract_address, search_category, search_item_id, network, item_id)
      VALUES (${`summary-${id}`}, ${type}, ${other}, ${owner}, ${price}, ${timestamp}, '0xhash', 1,
        ${address}, 'wearable', ${itemId}, 'matic', ${`${address}_${itemId}`})
    `)
  }

  async function summary(query = `seller=${seller}`) {
    const response = await components.localFetch.fetch(`/v1/sales/summary?${query}`)
    expect(response.status).toBe(200)
    return (await response.json()).data
  }

  beforeEach(async () => {
    await createSquidDBItem(components, { contractAddress: contract, itemId: '0' })
    await createSquidDBItem(components, { contractAddress: secondContract, itemId: '0' })
    // Checksummed on purpose: the indexer stores an address as it finds it, and every other creator
    // filter in this repo lowercases the column before comparing. Written lowercase here, a mixed-case
    // creator would silently report no royalties at all.
    await components.dappsDatabase.query(
      SQL`UPDATE squid_marketplace.item SET creator = ${seller.toUpperCase().replace('0X', '0x')} WHERE id = ${`${contract}_0`}`
    )
  })

  afterEach(async () => {
    await components.dappsDatabase.query(SQL`DELETE FROM squid_marketplace.sale WHERE id LIKE 'summary-%'`)
    await deleteSquidDBItem(components, '0', contract)
    await deleteSquidDBItem(components, '0', secondContract)
  })

  it.each([
    '',
    'seller=',
    'seller=invalid',
    `seller=${seller}&from=nope`,
    `seller=${seller}&to=1.5`,
    `seller=${seller}&from=-1`,
    `seller=${seller}&from=9007199254740992`,
    `seller=${seller}&from=2000&to=1000`,
    `seller=${seller}&to=`,
    `seller=${seller}&from=12abc`
  ])('rejects invalid parameters: %s', async query => {
    const response = await components.localFetch.fetch(`/v1/sales/summary?${query}`)
    expect(response.status).toBe(400)
  })

  it('returns zeros and empty arrays when there are no sales', async () => {
    expect(await summary()).toEqual(empty)
  })

  it('aggregates exact wei, separates seller and creator, and handles item zero across contracts', async () => {
    await addSale('mint-before', 'mint', seller, 1)
    await addSale('mint-start', 'mint', seller, 2)
    await addSale('order-end', 'order', seller, 3)
    await addSale('bid-after', 'bid', seller, 4, secondContract)
    await addSale('mint-second', 'mint', seller, 2, secondContract)
    await addSale('other-order', 'order', other, 2)
    await addSale('other-bid', 'bid', other, 3)
    await addSale('other-mint', 'mint', other, 2)
    await addSale('unrelated-order', 'order', other, 2, secondContract)
    const lifetimeItems = [
      { contractAddress: contract, itemId: '0', soldLifetime: 2 },
      { contractAddress: secondContract, itemId: '0', soldLifetime: 1 }
    ]
    expect(await summary(`seller=${seller.toUpperCase().replace('0X', '0x')}&from=2000&to=3000`)).toEqual({
      total: 3,
      mints: 2,
      resales: 1,
      earnedWei: (BigInt(price) * 3n).toString(),
      byCollection: [
        { contractAddress: contract, sold: 2, earnedWei: (BigInt(price) * 2n).toString() },
        { contractAddress: secondContract, sold: 1, earnedWei: price }
      ],
      byItem: lifetimeItems,
      royalties: { resales: 3, volumeWei: (BigInt(price) * 3n).toString() }
    })
    expect(await summary()).toMatchObject({ total: 5, mints: 3, resales: 2, earnedWei: (BigInt(price) * 5n).toString() })
    expect(await summary(`seller=${seller}&from=5000`)).toEqual({ ...empty, byItem: lifetimeItems })
    expect(await summary(`seller=${seller}&to=0`)).toEqual({ ...empty, byItem: lifetimeItems })
    expect(await summary(`seller=${seller}&from=2001&to=2999`)).toEqual({ ...empty, byItem: lifetimeItems })
  })

  it('returns creator resales even when the creator has never sold directly', async () => {
    await addSale('third-party', 'bid', other, 2)
    expect(await summary()).toEqual({ ...empty, royalties: { resales: 1, volumeWei: price } })
  })

  it('does not apply the sales feed pagination limit', async () => {
    await components.dappsDatabase.query(SQL`
      INSERT INTO squid_marketplace.sale
        (id, type, buyer, seller, price, timestamp, tx_hash, search_token_id,
         search_contract_address, search_category, search_item_id, network, item_id)
      SELECT 'summary-bulk-' || n, 'mint', ${other}, ${seller}, ${price}::numeric, 1, '0xhash', n,
        ${contract}, 'wearable', 0, 'matic', ${`${contract}_0`}
      FROM generate_series(1, 5001) n
    `)
    expect(await summary()).toEqual({
      total: 5001,
      mints: 5001,
      resales: 0,
      earnedWei: (BigInt(price) * 5001n).toString(),
      byCollection: [{ contractAddress: contract, sold: 5001, earnedWei: (BigInt(price) * 5001n).toString() }],
      byItem: [{ contractAddress: contract, itemId: '0', soldLifetime: 5001 }],
      royalties: empty.royalties
    })
    const response = await components.localFetch.fetch(`/v1/sales?seller=${seller}&first=1000`)
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.total).toBe(5001)
    expect(body.data).toHaveLength(1000)
  })
})
