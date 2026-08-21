import { ChainId } from '@dcl/schemas'
import * as chainIdUtils from '../../src/logic/chainIds'
import { test } from '../components'
import {
  clearSquidTradesRows,
  createSquidDBBidTrade,
  createSquidSignatureIndexRow,
  createSquidTradeActionRow,
  deleteSquidDBTrade,
  setTradeDigest
} from './utils/dbItems'

/**
 * Trade status is computed entirely in SQL from the indexer's tables, and nothing in the suite wrote a row
 * into them, so every LEFT JOIN yielded NULL and the status CASE always fell through to open. A join
 * written as AND instead of OR, matched on the wrong column, or missing its network or contract scope was
 * indistinguishable from a correct one. Every case below fails if one specific predicate is removed.
 */
test('trade status computed from indexer rows', function ({ components }) {
  // The column default on marketplace.trades, and checksummed, which is why the joins lower() it.
  const TRADE_CONTRACT = '0x540fb08eDb56AaE562864B390542C97F562825BA'
  const OTHER_MARKETPLACE = '0x36fd1434a6c4b8ade80c9847c1d15033ce34488c'
  const SIGNER = '0x1234567890123456789012345678901234567890'
  const STRANGER = '0x9999999999999999999999999999999999999999'
  const CONTRACT_ADDRESS = '0x0000000000000000000000000000000000000abc'

  let signature: string
  let tradeId: string

  beforeEach(async () => {
    jest.spyOn(chainIdUtils, 'getEthereumChainId').mockReturnValue(ChainId.ETHEREUM_SEPOLIA)
    jest.spyOn(chainIdUtils, 'getPolygonChainId').mockReturnValue(ChainId.MATIC_AMOY)

    signature = `status-fixture-${Date.now()}-${Math.random()}`
    tradeId = await createSquidDBBidTrade(components, {
      contractAddress: CONTRACT_ADDRESS,
      tokenId: '1',
      bidder: SIGNER,
      signature,
      network: 'MATIC'
    })
  })

  afterEach(async () => {
    await clearSquidTradesRows(components)
    await deleteSquidDBTrade(components, tradeId)
  })

  async function fetchStatus(): Promise<string | undefined> {
    const response = await components.localFetch.fetch(`/v1/bids?contractAddress=${CONTRACT_ADDRESS}&tokenId=1&limit=10&offset=0`)
    const body = await response.json()
    return body.data?.results?.[0]?.status
  }

  describe('and the indexer has no rows for the trade', () => {
    it('should report the bid as open', async () => {
      expect(await fetchStatus()).toBe('open')
    })
  })

  describe('and the trade signer cancelled it', () => {
    beforeEach(async () => {
      await createSquidTradeActionRow(components, { signature, action: 'cancelled', caller: SIGNER, network: 'POLYGON' })
    })

    it('should report the bid as cancelled', async () => {
      expect(await fetchStatus()).toBe('cancelled')
    })
  })

  describe('and somebody other than the signer called cancelSignature on it', () => {
    beforeEach(async () => {
      await createSquidTradeActionRow(components, { signature, action: 'cancelled', caller: STRANGER, network: 'POLYGON' })
    })

    // The contract scopes a cancellation to keccak256(caller, digest) and settlement reads
    // keccak256(signer, digest), so a stranger cancelling is a no-op on chain. Counting it here let
    // anyone grief a listing into disappearing while it stayed settleable.
    it('should still report the bid as open', async () => {
      expect(await fetchStatus()).toBe('open')
    })
  })

  describe('and a V3 cancellation carries the trade digest rather than the signature hash', () => {
    const DIGEST = '0x540e09a0efdfaa3f24471cd8b91258b8a269ce60cf29aad889e162553e607891'

    beforeEach(async () => {
      await setTradeDigest(components, { hashedSignature: signature, tradeDigest: DIGEST })
      // V3 keys cancellations on the EIP-712 digest, and the indexer writes it into `signature`.
      await createSquidTradeActionRow(components, { signature: DIGEST, action: 'cancelled', caller: SIGNER, network: 'POLYGON' })
    })

    it('should report the bid as cancelled', async () => {
      expect(await fetchStatus()).toBe('cancelled')
    })
  })

  describe('and the signer bumped their signature index on the marketplace the trade targets', () => {
    beforeEach(async () => {
      await createSquidSignatureIndexRow(components, {
        address: SIGNER,
        contract: TRADE_CONTRACT,
        network: 'POLYGON',
        index: 1
      })
    })

    // The trade signed signerSignatureIndex 0. Reaching this row at all also proves the MATIC -> POLYGON
    // translation fires, since the trade's network is MATIC and the indexer writes POLYGON.
    it('should report the bid as cancelled', async () => {
      expect(await fetchStatus()).toBe('cancelled')
    })
  })

  describe('and a contract signature index row is keyed to this marketplace but held by another', () => {
    beforeEach(async () => {
      // address matches the trade's marketplace, contract does not. Only reachable because a row's
      // identity is address + contract + network, so address alone is no longer unique.
      await createSquidSignatureIndexRow(components, {
        address: TRADE_CONTRACT,
        contract: OTHER_MARKETPLACE,
        network: 'POLYGON',
        index: 1
      })
    })

    it('should still report the bid as open', async () => {
      expect(await fetchStatus()).toBe('open')
    })
  })

  describe('and the marketplace the trade targets bumped its own contract signature index', () => {
    beforeEach(async () => {
      await createSquidSignatureIndexRow(components, {
        address: TRADE_CONTRACT,
        contract: TRADE_CONTRACT,
        network: 'POLYGON',
        index: 1
      })
    })

    // The trade signed contractSignatureIndex 0.
    it('should report the bid as cancelled', async () => {
      expect(await fetchStatus()).toBe('cancelled')
    })
  })

  describe('and the signer bumped their signature index on a different marketplace version', () => {
    beforeEach(async () => {
      await createSquidSignatureIndexRow(components, {
        address: SIGNER,
        contract: OTHER_MARKETPLACE,
        network: 'POLYGON',
        index: 1
      })
    })

    // signerSignatureIndex is storage on each deployment, so a bump on another version says nothing about
    // this trade. Without the contract scope this row matched and cancelled it.
    it('should still report the bid as open', async () => {
      expect(await fetchStatus()).toBe('open')
    })
  })
})
