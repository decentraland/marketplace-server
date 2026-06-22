import { ChainId, Network } from '@dcl/schemas'
import {
  addressToTopic,
  buildManaTransferFeed,
  classifyLeg,
  correlateFifo,
  decodeTransferLog,
  getBridgeAddresses,
  getRpcUrlByChainId,
  TRANSFER_EVENT_TOPIC,
  topicToAddress
} from '../../src/ports/mana-transfers/logic'
import { DecodedTransfer, ManaTransferStatus, ManaTransferType, RawTransferLog } from '../../src/ports/mana-transfers/types'

const USER = '0xd9b96b5dc720fc52bede1ec3b40a930e15f70ddd'
const OTHER = '0x9a6ebe7e2a7722f8200d0ffb63a1f6406a0d7dce'
const CONTRACT = '0x0ff58e235b154dd7785c4829d48948ce114248c4'
const ZERO = '0x0000000000000000000000000000000000000000'
const PREDICATE = getBridgeAddresses(ChainId.ETHEREUM_MAINNET).erc20Predicate

const mana = (units: number): bigint => BigInt(units) * 10n ** 18n

const decoded = (overrides: Partial<DecodedTransfer> = {}): DecodedTransfer => ({
  network: Network.ETHEREUM,
  from: USER,
  to: OTHER,
  value: mana(100),
  hash: '0xaaa',
  logIndex: 0,
  blockNumber: 1,
  timestamp: 1000,
  ...overrides
})

describe('when converting addresses to and from indexed topics', () => {
  it('should left-pad an address to a 32-byte lowercased topic', () => {
    expect(addressToTopic(USER)).toBe(`0x000000000000000000000000${USER.slice(2)}`)
  })

  it('should recover the lowercased address from a topic', () => {
    expect(topicToAddress(addressToTopic(USER))).toBe(USER)
  })
})

describe('when resolving the RPC url by chain id', () => {
  it('should map each supported chain to its DCL RPC path', () => {
    expect(getRpcUrlByChainId(ChainId.ETHEREUM_MAINNET)).toBe('https://rpc.decentraland.org/mainnet')
    expect(getRpcUrlByChainId(ChainId.ETHEREUM_SEPOLIA)).toBe('https://rpc.decentraland.org/sepolia')
    expect(getRpcUrlByChainId(ChainId.MATIC_MAINNET)).toBe('https://rpc.decentraland.org/polygon')
    expect(getRpcUrlByChainId(ChainId.MATIC_AMOY)).toBe('https://rpc.decentraland.org/amoy')
  })

  it('should throw on an unsupported chain', () => {
    expect(() => getRpcUrlByChainId(999999 as ChainId)).toThrow()
  })
})

describe('when decoding a raw transfer log', () => {
  let log: RawTransferLog

  beforeEach(() => {
    log = {
      address: getBridgeAddresses(ChainId.ETHEREUM_MAINNET).mana,
      topics: [TRANSFER_EVENT_TOPIC, addressToTopic(OTHER), addressToTopic(USER)],
      data: `0x${mana(306).toString(16).padStart(64, '0')}`,
      blockNumber: '0x10c0796',
      blockTimestamp: '0x6499e323',
      transactionHash: '0xFADTX',
      logIndex: '0x76'
    }
  })

  it('should extract from, to, value, hash, indexes and a millisecond timestamp', () => {
    const result = decodeTransferLog(log, Network.ETHEREUM)
    expect(result).toEqual({
      network: Network.ETHEREUM,
      from: OTHER,
      to: USER,
      value: mana(306),
      hash: '0xfadtx',
      logIndex: 118,
      blockNumber: 17565590,
      timestamp: 0x6499e323 * 1000
    })
  })

  it('should default the timestamp to 0 when blockTimestamp is missing', () => {
    const result = decodeTransferLog({ ...log, blockTimestamp: undefined }, Network.ETHEREUM)
    expect(result.timestamp).toBe(0)
  })

  it('should throw on a log with fewer than 3 topics (defensive guard for external callers)', () => {
    expect(() => decodeTransferLog({ ...log, topics: [TRANSFER_EVENT_TOPIC] }, Network.ETHEREUM)).toThrow('Malformed Transfer log')
  })
})

describe('when classifying a transfer leg', () => {
  describe('and the network is Ethereum (L1)', () => {
    it('should classify a transfer to the ERC20 predicate as a deposit', () => {
      expect(classifyLeg(decoded({ from: USER, to: PREDICATE }), USER, PREDICATE)).toBe('deposit')
    })

    it('should classify a transfer from the ERC20 predicate as an exit', () => {
      expect(classifyLeg(decoded({ from: PREDICATE, to: USER }), USER, PREDICATE)).toBe('exit')
    })

    it('should classify any other outgoing transfer as a send', () => {
      expect(classifyLeg(decoded({ from: USER, to: OTHER }), USER, PREDICATE)).toBe('send')
    })

    it('should classify any other incoming transfer as a received', () => {
      expect(classifyLeg(decoded({ from: OTHER, to: USER }), USER, PREDICATE)).toBe('received')
    })
  })

  describe('and the network is Polygon (L2)', () => {
    it('should classify a mint from the zero address as a bridge credit', () => {
      expect(classifyLeg(decoded({ network: Network.MATIC, from: ZERO, to: USER }), USER, '')).toBe('credit')
    })

    it('should classify a burn to the zero address as a withdraw origin', () => {
      expect(classifyLeg(decoded({ network: Network.MATIC, from: USER, to: ZERO }), USER, '')).toBe('burn')
    })

    it('should classify a transfer from a contract as a received, not a credit', () => {
      expect(classifyLeg(decoded({ network: Network.MATIC, from: CONTRACT, to: USER }), USER, '')).toBe('received')
    })

    it('should classify an outgoing transfer as a send', () => {
      expect(classifyLeg(decoded({ network: Network.MATIC, from: USER, to: OTHER }), USER, '')).toBe('send')
    })
  })
})

describe('when correlating bridge legs with FIFO', () => {
  it('should match an origin with the earliest later closing of the same value', () => {
    const deposit = decoded({ value: mana(306), timestamp: 1000, hash: '0xdep' })
    const credit = decoded({ network: Network.MATIC, value: mana(306), timestamp: 2000, hash: '0xcre' })
    const matches = correlateFifo([deposit], [credit])
    expect(matches.get(`${Network.ETHEREUM}-0xdep-0`)).toEqual(credit)
  })

  it('should not match a closing that happened before the origin', () => {
    const deposit = decoded({ value: mana(306), timestamp: 5000, hash: '0xdep' })
    const credit = decoded({ network: Network.MATIC, value: mana(306), timestamp: 1000, hash: '0xcre' })
    expect(correlateFifo([deposit], [credit]).size).toBe(0)
  })

  it('should not match when values differ', () => {
    const deposit = decoded({ value: mana(306), timestamp: 1000, hash: '0xdep' })
    const credit = decoded({ network: Network.MATIC, value: mana(200), timestamp: 2000, hash: '0xcre' })
    expect(correlateFifo([deposit], [credit]).size).toBe(0)
  })

  it('should pair repeated amounts in chronological order and consume each closing once', () => {
    const d1 = decoded({ value: mana(100), timestamp: 1000, hash: '0xd1' })
    const d2 = decoded({ value: mana(100), timestamp: 1500, hash: '0xd2' })
    const c1 = decoded({ network: Network.MATIC, value: mana(100), timestamp: 2000, hash: '0xc1' })
    const c2 = decoded({ network: Network.MATIC, value: mana(100), timestamp: 2500, hash: '0xc2' })
    const matches = correlateFifo([d2, d1], [c2, c1])
    expect(matches.get(`${Network.ETHEREUM}-0xd1-0`)).toEqual(c1)
    expect(matches.get(`${Network.ETHEREUM}-0xd2-0`)).toEqual(c2)
  })
})

describe('when building the MANA transfer feed', () => {
  it('should anchor a swap on the L1 deposit and correlate the L2 credit as counterpartHash', () => {
    const deposit = decoded({ from: USER, to: PREDICATE, value: mana(306), timestamp: 1000, hash: '0xdep' })
    const credit = decoded({ network: Network.MATIC, from: ZERO, to: USER, value: mana(306), timestamp: 3000, hash: '0xcre' })

    const feed = buildManaTransferFeed({
      ethereumTransfers: [deposit],
      polygonTransfers: [credit],
      user: USER,
      ethereumPredicate: PREDICATE
    })

    expect(feed).toHaveLength(1)
    expect(feed[0]).toMatchObject({
      hash: '0xdep',
      type: ManaTransferType.SWAP,
      network: Network.ETHEREUM,
      status: ManaTransferStatus.CONFIRMED,
      counterpartHash: '0xcre',
      amount: '306.0',
      value: mana(306).toString()
    })
  })

  it('should never surface the L2 mint as a received row', () => {
    const deposit = decoded({ from: USER, to: PREDICATE, value: mana(306), timestamp: 1000, hash: '0xdep' })
    const credit = decoded({ network: Network.MATIC, from: ZERO, to: USER, value: mana(306), timestamp: 3000, hash: '0xcre' })

    const feed = buildManaTransferFeed({
      ethereumTransfers: [deposit],
      polygonTransfers: [credit],
      user: USER,
      ethereumPredicate: PREDICATE
    })

    expect(feed.some(t => t.type === ManaTransferType.RECEIVED)).toBe(false)
  })

  it('should mark a deposit without a credit as bridging', () => {
    const deposit = decoded({ from: USER, to: PREDICATE, value: mana(500), timestamp: 1000, hash: '0xdep' })

    const feed = buildManaTransferFeed({ ethereumTransfers: [deposit], polygonTransfers: [], user: USER, ethereumPredicate: PREDICATE })

    expect(feed[0]).toMatchObject({ type: ManaTransferType.SWAP, status: ManaTransferStatus.BRIDGING })
    expect(feed[0].counterpartHash).toBeUndefined()
  })

  it('should promote an orphan L2 credit to its own swap row', () => {
    const credit = decoded({ network: Network.MATIC, from: ZERO, to: USER, value: mana(200), timestamp: 3000, hash: '0xcre' })

    const feed = buildManaTransferFeed({ ethereumTransfers: [], polygonTransfers: [credit], user: USER, ethereumPredicate: PREDICATE })

    expect(feed).toHaveLength(1)
    expect(feed[0]).toMatchObject({
      hash: '0xcre',
      type: ManaTransferType.SWAP,
      network: Network.MATIC,
      status: ManaTransferStatus.CONFIRMED
    })
  })

  it('should anchor a withdraw on the L2 burn and correlate the L1 exit', () => {
    const burn = decoded({ network: Network.MATIC, from: USER, to: ZERO, value: mana(50), timestamp: 1000, hash: '0xburn' })
    const exit = decoded({ network: Network.ETHEREUM, from: PREDICATE, to: USER, value: mana(50), timestamp: 4000, hash: '0xexit' })

    const feed = buildManaTransferFeed({ ethereumTransfers: [exit], polygonTransfers: [burn], user: USER, ethereumPredicate: PREDICATE })

    expect(feed).toHaveLength(1)
    expect(feed[0]).toMatchObject({
      hash: '0xburn',
      type: ManaTransferType.WITHDRAW,
      network: Network.MATIC,
      status: ManaTransferStatus.CONFIRMED,
      counterpartHash: '0xexit'
    })
  })

  it('should pass plain sends and receiveds through', () => {
    const send = decoded({ from: USER, to: OTHER, value: mana(100), timestamp: 2000, hash: '0xsend' })
    const received = decoded({ network: Network.MATIC, from: CONTRACT, to: USER, value: mana(10), timestamp: 1000, hash: '0xrec' })

    const feed = buildManaTransferFeed({
      ethereumTransfers: [send],
      polygonTransfers: [received],
      user: USER,
      ethereumPredicate: PREDICATE
    })

    expect(feed.map(t => ({ hash: t.hash, type: t.type }))).toEqual([
      { hash: '0xsend', type: ManaTransferType.SEND },
      { hash: '0xrec', type: ManaTransferType.RECEIVED }
    ])
  })

  it('should dedupe transfers by network, hash and logIndex', () => {
    const send = decoded({ from: USER, to: OTHER, value: mana(100), timestamp: 1000, hash: '0xdup', logIndex: 0 })

    const feed = buildManaTransferFeed({
      ethereumTransfers: [send, { ...send }],
      polygonTransfers: [],
      user: USER,
      ethereumPredicate: PREDICATE
    })

    expect(feed).toHaveLength(1)
  })

  it('should sort the feed newest first', () => {
    const older = decoded({ from: USER, to: OTHER, value: mana(1), timestamp: 1000, hash: '0xold' })
    const newer = decoded({ from: USER, to: OTHER, value: mana(2), timestamp: 9000, hash: '0xnew' })

    const feed = buildManaTransferFeed({
      ethereumTransfers: [older, newer],
      polygonTransfers: [],
      user: USER,
      ethereumPredicate: PREDICATE
    })

    expect(feed.map(t => t.hash)).toEqual(['0xnew', '0xold'])
  })
})
