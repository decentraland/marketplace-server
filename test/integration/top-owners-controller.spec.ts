import SQL from 'sql-template-strings'
import { test } from '../components'
import { createSquidDBItem, createSquidDBNFT, deleteSquidDBItem, deleteSquidDBNFT } from './utils/dbItems'

test('top owners of a creator', ({ components }) => {
  const creator = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  const collector = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  const casual = '0xcccccccccccccccccccccccccccccccccccccccc'
  const contract = '0x1111111111111111111111111111111111111111'
  const secondContract = '0x2222222222222222222222222222222222222222'
  const otherContract = '0x3333333333333333333333333333333333333333'
  const price = '900719925474099312345'
  const nfts: [string, string][] = []

  async function holding(tokenId: string, address: string, owner: string, itemId: string, transferredAt: number) {
    await createSquidDBNFT(components, { tokenId, contractAddress: address, owner })
    await components.dappsDatabase.query(
      SQL`UPDATE squid_marketplace.nft SET item_id = ${`${address}_${itemId}`}, transferred_at = ${transferredAt}
          WHERE id = ${`${address}-${tokenId}`}`
    )
    nfts.push([tokenId, address])
  }

  async function bought(id: string, buyer: string, address: string, itemId: string) {
    await components.dappsDatabase.query(SQL`
      INSERT INTO squid_marketplace.sale
        (id, type, buyer, seller, price, timestamp, tx_hash, search_token_id,
         search_contract_address, search_category, search_item_id, network, item_id)
      VALUES (${`top-owners-${id}`}, 'mint', ${buyer}, ${creator}, ${price}, 1, '0xhash', 1,
        ${address}, 'wearable', ${itemId}, 'matic', ${`${address}_${itemId}`})
    `)
  }

  async function topOwners(query: string) {
    const response = await components.localFetch.fetch(`/v1/owners/top?${query}`)
    expect(response.status).toBe(200)
    return response.json()
  }

  beforeEach(async () => {
    for (const address of [contract, secondContract, otherContract]) {
      await createSquidDBItem(components, { contractAddress: address, itemId: '0' })
    }
    await createSquidDBItem(components, { contractAddress: contract, itemId: '1' })
    // Checksummed on purpose: the indexer stores an address as it finds it.
    await components.dappsDatabase.query(
      SQL`UPDATE squid_marketplace.item SET creator = ${creator.toUpperCase().replace('0X', '0x')}
          WHERE id = ANY(${[`${contract}_0`, `${contract}_1`, `${secondContract}_0`]})`
    )
    await holding('1', contract, collector, '0', 100)
    await holding('2', contract, collector, '1', 300)
    await holding('3', secondContract, collector, '0', 200)
    await holding('4', contract, casual, '0', 400)
    await holding('5', contract, creator, '0', 500)
    await holding('6', otherContract, casual, '0', 600)
    await bought('collector-1', collector, contract, '0')
    await bought('casual-1', casual, contract, '0')
    await bought('casual-2', casual, secondContract, '0')
  })

  afterEach(async () => {
    await components.dappsDatabase.query(SQL`DELETE FROM squid_marketplace.sale WHERE id LIKE 'top-owners-%'`)
    for (const [tokenId, address] of nfts.splice(0)) await deleteSquidDBNFT(components, tokenId, address)
    await deleteSquidDBItem(components, '1', contract)
    for (const address of [contract, secondContract, otherContract]) await deleteSquidDBItem(components, '0', address)
    await components.cache.remove(`top-owners:${creator}`)
  })

  it.each(['', 'creator=invalid', `creator=${creator}&sortBy=price`, `creator=${creator}&orderDirection=up`])(
    'rejects invalid parameters: %s',
    async query => {
      const response = await components.localFetch.fetch(`/v1/owners/top?${query}`)
      expect(response.status).toBe(400)
    }
  )

  it("ranks the creator's holders across collections, leaving out the creator and other creators' items", async () => {
    expect(await topOwners(`creator=${creator}`)).toEqual({
      data: [
        { address: collector, nfts: 3, items: 3, collections: 2, lastAcquiredAt: 300_000, spentWei: price },
        { address: casual, nfts: 1, items: 1, collections: 1, lastAcquiredAt: 400_000, spentWei: (BigInt(price) * 2n).toString() }
      ],
      total: 2
    })
  })

  it('sorts by what they spent and pages the result', async () => {
    const response = await topOwners(`creator=${creator}&sortBy=spent&first=1`)
    expect(response.total).toBe(2)
    expect(response.data.map((o: { address: string }) => o.address)).toEqual([casual])
  })

  it('returns an empty page for a creator nobody holds', async () => {
    expect(await topOwners(`creator=${collector}`)).toEqual({ data: [], total: 0 })
  })
})
