import { JsonRpcProvider } from 'ethers'
import { ICacheStorageComponent } from '@dcl/core-commons'
import { ChainId, Network } from '@dcl/schemas'
import { createManaTransfersComponent } from '../../src/ports/mana-transfers/component'
import { addressToTopic, getBridgeAddresses, TRANSFER_EVENT_TOPIC } from '../../src/ports/mana-transfers/logic'
import { IManaTransfersComponent, ManaTransferStatus, ManaTransferType, RawTransferLog } from '../../src/ports/mana-transfers/types'
import { createCacheMockedComponent } from '../mocks/cache-mock'
import { createLoggerMockedComponent } from '../mocks/logger-mock'

const mockSend = jest.fn()

jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers')
  return {
    ...actual,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    JsonRpcProvider: jest.fn().mockImplementation(() => ({ send: mockSend }))
  }
})

// Pin the chain ids so getBridgeAddresses resolves to mainnet/polygon in the test.
jest.mock('../../src/logic/chainIds', () => ({
  getEthereumChainId: () => 1, // ChainId.ETHEREUM_MAINNET
  getPolygonChainId: () => 137 // ChainId.MATIC_MAINNET
}))

const USER = '0xd9b96b5dc720fc52bede1ec3b40a930e15f70ddd'
const OTHER_ADDRESS = '0x9a6ebe7e2a7722f8200d0ffb63a1f6406a0d7dce'
const ZERO = '0x0000000000000000000000000000000000000000'
const ETHEREUM = getBridgeAddresses(ChainId.ETHEREUM_MAINNET)
const USER_TOPIC = addressToTopic(USER)
const MANA_306 = 306n * 10n ** 18n

const rawLog = (from: string, to: string, value: bigint, hash: string, removed = false): RawTransferLog => ({
  address: ETHEREUM.mana,
  topics: [TRANSFER_EVENT_TOPIC, addressToTopic(from), addressToTopic(to)],
  data: `0x${value.toString(16).padStart(64, '0')}`,
  blockNumber: '0x1',
  blockTimestamp: '0x3e8',
  transactionHash: hash,
  logIndex: '0x0',
  removed
})

let inMemoryCache: ICacheStorageComponent
let mockGet: jest.MockedFn<ICacheStorageComponent['get']>
let mockSet: jest.MockedFn<ICacheStorageComponent['set']>
let component: IManaTransfersComponent

beforeEach(() => {
  // resetMocks: true wipes the factory implementation between tests, so re-establish it here.
  ;(JsonRpcProvider as unknown as jest.Mock).mockImplementation(() => ({ send: mockSend }))
  mockGet = jest.fn()
  mockSet = jest.fn()
  mockGet.mockResolvedValue(undefined)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inMemoryCache = createCacheMockedComponent({ get: mockGet as any, set: mockSet })
  component = createManaTransfersComponent({ logs: createLoggerMockedComponent(), inMemoryCache })
})

describe('when getting MANA transfers for an invalid address', () => {
  it('should throw', async () => {
    await expect(component.getManaTransfers('not-an-address')).rejects.toThrow('Invalid address')
  })
})

describe('when the result is already cached', () => {
  let cached: { data: []; total: number }

  beforeEach(() => {
    cached = { data: [], total: 0 }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockGet.mockResolvedValueOnce(cached as any)
  })

  it('should return the cached value', async () => {
    const result = await component.getManaTransfers(USER)
    expect(result).toBe(cached)
  })

  it('should not hit the RPC', async () => {
    await component.getManaTransfers(USER)
    expect(mockSend).not.toHaveBeenCalled()
  })
})

describe('when the result is not cached', () => {
  beforeEach(() => {
    mockSend.mockImplementation(async (_method: string, params: [{ address: string; topics: (string | null)[] }]) => {
      const [filter] = params
      const isEthereum = filter.address === ETHEREUM.mana
      const fromUser = filter.topics[1] === USER_TOPIC
      const toUser = filter.topics[2] === USER_TOPIC
      // L1 outgoing: a bridge deposit to the predicate. L2 incoming: the matching mint credit.
      if (isEthereum && fromUser) return [rawLog(USER, ETHEREUM.erc20Predicate, MANA_306, '0xdep')]
      if (!isEthereum && toUser) return [rawLog(ZERO, USER, MANA_306, '0xcre')]
      return []
    })
  })

  it('should query the four log filters (sent + received per chain)', async () => {
    await component.getManaTransfers(USER)
    expect(mockSend).toHaveBeenCalledTimes(4)
    expect(mockSend).toHaveBeenCalledWith('eth_getLogs', expect.any(Array))
  })

  it('should build a single confirmed swap from the deposit correlated with the credit', async () => {
    const { data, total } = await component.getManaTransfers(USER)
    expect(total).toBe(1)
    expect(data[0]).toMatchObject({
      hash: '0xdep',
      type: ManaTransferType.SWAP,
      network: Network.ETHEREUM,
      status: ManaTransferStatus.CONFIRMED,
      counterpartHash: '0xcre'
    })
  })

  it('should cache the result with a TTL', async () => {
    await component.getManaTransfers(USER)
    expect(mockSet).toHaveBeenCalledWith(`mana-transfers:${USER}`, expect.objectContaining({ total: 1 }), 120)
  })

  it('should ignore removed logs', async () => {
    mockSend.mockImplementation(async (_method: string, params: [{ address: string; topics: (string | null)[] }]) => {
      const [filter] = params
      if (filter.address === ETHEREUM.mana && filter.topics[1] === USER_TOPIC) {
        return [rawLog(USER, ETHEREUM.erc20Predicate, MANA_306, '0xremoved', true)]
      }
      return []
    })
    const { total } = await component.getManaTransfers(USER)
    expect(total).toBe(0)
  })

  it('should ignore malformed logs (missing topics or empty data)', async () => {
    mockSend.mockImplementation(async (_method: string, params: [{ address: string; topics: (string | null)[] }]) => {
      const [filter] = params
      if (filter.address === ETHEREUM.mana && filter.topics[1] === USER_TOPIC) {
        return [
          {
            address: ETHEREUM.mana,
            topics: [TRANSFER_EVENT_TOPIC],
            data: '0x',
            blockNumber: '0x1',
            transactionHash: '0xbad',
            logIndex: '0x0'
          }
        ]
      }
      return []
    })
    const { total } = await component.getManaTransfers(USER)
    expect(total).toBe(0)
  })

  it('should skip a log whose data is non-hex (decode throws) without aborting the feed', async () => {
    mockSend.mockImplementation(async (_method: string, params: [{ address: string; topics: (string | null)[] }]) => {
      const [filter] = params
      if (filter.address === ETHEREUM.mana && filter.topics[1] === USER_TOPIC) {
        return [
          {
            address: ETHEREUM.mana,
            topics: [TRANSFER_EVENT_TOPIC, addressToTopic(USER), addressToTopic(OTHER_ADDRESS)],
            data: '0xnothex',
            blockNumber: '0x1',
            blockTimestamp: '0x3e8',
            transactionHash: '0xbaddata',
            logIndex: '0x0'
          }
        ]
      }
      return []
    })
    const { total } = await component.getManaTransfers(USER)
    expect(total).toBe(0)
  })

  it('should throw rather than cache a truncated feed when a filter hits the RPC result cap', async () => {
    const truncated = Array.from({ length: 10000 }, (_unused, index) => rawLog(USER, OTHER_ADDRESS, 1n, `0x${index.toString(16)}`))
    mockSend.mockResolvedValue(truncated)
    await expect(component.getManaTransfers(USER)).rejects.toThrow('result cap')
    expect(mockSet).not.toHaveBeenCalled()
  })
})
