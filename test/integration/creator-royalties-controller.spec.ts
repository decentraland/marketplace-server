import SQL from 'sql-template-strings'
import { test } from '../components'
import { createSquidDBItem, deleteSquidDBItem } from './utils/dbItems'

test('creator royalties', ({ components }) => {
  const creator = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  const collector = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  const reseller = '0xcccccccccccccccccccccccccccccccccccccccc'
  const buyer = '0xdddddddddddddddddddddddddddddddddddddddd'
  const contract = '0x1111111111111111111111111111111111111111'
  const otherContract = '0x2222222222222222222222222222222222222222'

  async function sale(
    id: string,
    type: string,
    address: string,
    timestamp: number,
    price: string,
    royalty: string | null,
    paidTo: string | null = collector
  ) {
    await components.dappsDatabase.query(SQL`
      INSERT INTO squid_marketplace.sale
        (id, type, buyer, seller, price, timestamp, tx_hash, search_token_id, search_contract_address,
         search_category, search_item_id, network, item_id, royalties_cut, royalties_collector)
      VALUES (${`royalties-${id}`}, ${type}, ${buyer}, ${reseller}, ${price}, ${timestamp}, '0xhash', 7, ${address},
        'wearable', 0, 'matic', ${`${address}_0`}, ${royalty}, decode(${paidTo ? paidTo.slice(2) : null}, 'hex'))
    `)
  }

  async function royalties(query: string) {
    const response = await components.localFetch.fetch(`/v1/sales/royalties?${query}`)
    expect(response.status).toBe(200)
    return response.json()
  }

  beforeEach(async () => {
    await createSquidDBItem(components, { contractAddress: contract, itemId: '0' })
    await createSquidDBItem(components, { contractAddress: otherContract, itemId: '0' })
    // Checksummed on purpose: the indexer stores an address as it finds it.
    await components.dappsDatabase.query(
      SQL`UPDATE squid_marketplace.item SET creator = ${creator.toUpperCase().replace('0X', '0x')} WHERE id = ${`${contract}_0`}`
    )
    await sale('old', 'order', contract, 1000, '1000', null, null)
    await sale('bid', 'bid', contract, 2000, '4000', '100')
    await sale('order', 'order', contract, 3000, '2000', '50')
    await sale('mint', 'mint', contract, 4000, '9000', null)
    await sale('other-creator', 'order', otherContract, 5000, '8000', '200')
  })

  afterEach(async () => {
    await components.dappsDatabase.query(SQL`DELETE FROM squid_marketplace.sale WHERE id LIKE 'royalties-%'`)
    await deleteSquidDBItem(components, '0', contract)
    await deleteSquidDBItem(components, '0', otherContract)
  })

  it.each(['', 'creator=nope', `creator=${creator}&from=abc`, `creator=${creator}&from=3000000&to=1000000`, `creator=${creator}&first=0`])(
    'rejects invalid parameters: %s',
    async query => {
      const response = await components.localFetch.fetch(`/v1/sales/royalties?${query}`)
      expect(response.status).toBe(400)
    }
  )

  it("lists the resales of the creator's items newest first, leaving out first sales and other creators", async () => {
    expect(await royalties(`creator=${creator}`)).toEqual({
      data: [
        expect.objectContaining({ id: 'royalties-order', timestamp: 3_000_000, priceWei: '2000', royaltyWei: '50', collector }),
        expect.objectContaining({ id: 'royalties-bid', timestamp: 2_000_000, priceWei: '4000', royaltyWei: '100', collector }),
        expect.objectContaining({ id: 'royalties-old', timestamp: 1_000_000, priceWei: '1000', royaltyWei: '0', collector: null })
      ],
      total: 3,
      royaltiesWei: '150'
    })
  })

  it('narrows to a window and pages it', async () => {
    const page = await royalties(`creator=${creator}&from=1500000&first=1&skip=1`)
    expect(page.total).toBe(2)
    expect(page.royaltiesWei).toBe('150')
    expect(page.data.map((row: { id: string }) => row.id)).toEqual(['royalties-bid'])
  })

  it('still answers the totals on a page past the end', async () => {
    expect(await royalties(`creator=${creator}&skip=50`)).toEqual({ data: [], total: 3, royaltiesWei: '150' })
  })

  it('answers zero for a creator with no resales', async () => {
    expect(await royalties(`creator=${buyer}`)).toEqual({ data: [], total: 0, royaltiesWei: '0' })
  })

  it('adds what the resales actually paid to the sales summary', async () => {
    const response = await components.localFetch.fetch(`/v1/sales/summary?seller=${creator}`)
    const { data } = await response.json()
    expect(data.royalties).toEqual({ resales: 3, volumeWei: '7000', royaltiesWei: '150' })
  })
})
