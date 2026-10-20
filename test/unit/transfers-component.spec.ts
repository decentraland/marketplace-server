import { Network, NFTCategory } from '@dcl/schemas'
import { getPolygonChainId } from '../../src/logic/chainIds'
import { IPgComponent } from '../../src/ports/db/types'
import { DBTransfer, ITransfersComponent, createTransfersComponent } from '../../src/ports/transfers'
import { getTransfersQuery } from '../../src/ports/transfers/queries'
import { SquidNetwork } from '../../src/types'
import { createTestPgComponent } from '../components'

describe('when building the transfers query', () => {
  let text: string
  let values: unknown[]

  beforeEach(() => {
    const query = getTransfersQuery({ address: '0xUSER', first: 50 })
    text = query.text.replace(/\s+/g, ' ')
    values = query.values
  })

  it('should look up both the transfers the address sent and the ones it received, lowercased', () => {
    expect(text).toContain('tf."from" = $1')
    expect(text).toMatch(/tf\."to" = \$\d+/)
    expect(values.filter(v => v === '0xuser').length).toBeGreaterThanOrEqual(3)
    expect(values).not.toContain('0xUSER')
  })

  it('should leave mints out of the received side', () => {
    expect(values).toContain('0x0000000000000000000000000000000000000000')
  })

  it('should leave out the transfers that settled a sale', () => {
    expect(text).toMatch(/squid_marketplace\.sale s WHERE s\.nft_id = \(CASE .* END\) AND s\.tx_hash = tf\.tx_hash/)
  })

  it('should match an Ethereum wearable transfer to its nft by the id without the category prefix', () => {
    expect(text).toContain("(CASE WHEN tf.nft_id LIKE 'wearable-%' THEN substr(tf.nft_id, 10) ELSE tf.nft_id END) AS nft_key")
    expect(text).toContain('JOIN squid_marketplace.nft n ON n.id = t.nft_key')
  })

  it('should return the newest transfers first, capped at the requested amount', () => {
    expect(text).toMatch(/ORDER BY t\.timestamp DESC, t\.id LIMIT \$\d+$/)
    expect(values[values.length - 1]).toBe(50)
  })

  it('should leave transfers to oneself out of the sent side', () => {
    expect(text).toMatch(/tf\."from" = \$1 AND tf\."to" <> \$2/)
  })

  it('should cap the amount at 500', () => {
    const query = getTransfersQuery({ address: '0xuser', first: 10_000 })
    expect(query.values[query.values.length - 1]).toBe(500)
  })

  it('should return the timestamp in milliseconds', () => {
    expect(text).toContain('(t.timestamp * 1000) AS timestamp')
  })
})

describe('when fetching transfers', () => {
  let transfers: ITransfersComponent
  let pg: IPgComponent

  beforeEach(() => {
    pg = createTestPgComponent()
    transfers = createTransfersComponent({ dappsDatabase: pg })
  })

  describe('and the address has no transfers', () => {
    beforeEach(() => {
      ;(pg.query as jest.Mock).mockResolvedValue({ rows: [], rowCount: 0 })
    })

    it('should return an empty list', async () => {
      expect(await transfers.getTransfers({ address: '0xuser', first: 10 })).toEqual([])
    })
  })

  describe('and the address has a transfer on Polygon', () => {
    let row: DBTransfer

    beforeEach(() => {
      row = {
        id: 'transfer-1',
        from: '0xflora',
        to: '0xuser',
        contract_address: '0xnft',
        token_id: '762',
        item_id: '0',
        category: NFTCategory.WEARABLE,
        tx_hash: '0xhash',
        timestamp: '1792424706000',
        network: SquidNetwork.POLYGON
      }
      ;(pg.query as jest.Mock).mockResolvedValue({ rows: [row], rowCount: 1 })
    })

    it('should map it to a transfer with a numeric timestamp and the Polygon network', async () => {
      expect(await transfers.getTransfers({ address: '0xuser', first: 10 })).toEqual([
        {
          id: 'transfer-1',
          from: '0xflora',
          to: '0xuser',
          contractAddress: '0xnft',
          tokenId: '762',
          itemId: '0',
          category: NFTCategory.WEARABLE,
          txHash: '0xhash',
          timestamp: 1792424706000,
          network: Network.MATIC,
          chainId: getPolygonChainId()
        }
      ])
    })
  })
})
