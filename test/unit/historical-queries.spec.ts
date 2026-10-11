import { MARKETPLACE_SQUID_SCHEMA, REGISTRY_SQUID_SCHEMA } from '../../src/constants'
import { getEstateSizesAtBlockQuery, getOwnersAtBlockQuery, getRentalsAtBlockQuery } from '../../src/ports/historical/queries'

const BLOCK = 20000000

describe('getOwnersAtBlockQuery', () => {
  describe('when no target is given', () => {
    it('should read the last transfer up to the block of every Ethereum NFT', () => {
      const query = getOwnersAtBlockQuery(BLOCK, {})

      expect(query.text).toContain(`${MARKETPLACE_SQUID_SCHEMA}.nft`)
      expect(query.text).toContain(`${MARKETPLACE_SQUID_SCHEMA}.transfer`)
      expect(query.text).toContain("network = 'ETHEREUM'")
      expect(query.text).toContain('t.block <= $1')
      expect(query.text).toContain('ORDER BY t.nft_id, t.block DESC')
      expect(query.text).not.toContain('category =')
      expect(query.values).toEqual([BLOCK])
    })
  })

  describe('when a category, contracts and item types are given', () => {
    it('should narrow the NFTs to them', () => {
      const query = getOwnersAtBlockQuery(BLOCK, {
        category: 'wearable',
        contractAddresses: ['0xabc'],
        itemTypes: ['wearable_v1', 'emote_v1']
      })

      expect(query.text).toContain('AND category = $1')
      expect(query.text).toContain('AND contract_address = ANY($2)')
      expect(query.text).toContain('AND item_type = ANY($3)')
      expect(query.values).toEqual(['wearable', ['0xabc'], ['wearable_v1', 'emote_v1'], BLOCK])
    })
  })
})

describe('getEstateSizesAtBlockQuery', () => {
  it('should count the parcels added and removed up to the block', () => {
    const query = getEstateSizesAtBlockQuery(BLOCK)

    expect(query.text).toContain(`${REGISTRY_SQUID_SCHEMA}.estate_history`)
    expect(query.text).toContain("WHEN 'AddLand' THEN 1 WHEN 'RemoveLand' THEN -1")
    expect(query.text).toContain('GROUP BY estate_token_id')
    expect(query.values).toEqual([BLOCK])
  })
})

describe('getRentalsAtBlockQuery', () => {
  it('should read the last rental up to the block of every asset', () => {
    const query = getRentalsAtBlockQuery(BLOCK)

    expect(query.text).toContain(`${REGISTRY_SQUID_SCHEMA}.rental`)
    expect(query.text).toContain('DISTINCT ON (contract_address, token_id)')
    expect(query.text).toContain('ORDER BY contract_address, token_id, block_number DESC, log_index DESC')
    expect(query.values).toEqual([BLOCK])
  })
})
