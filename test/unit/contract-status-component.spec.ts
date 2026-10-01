import { IBaseComponent, START_COMPONENT, STOP_COMPONENT } from '@well-known-components/interfaces'
import { createContractStatusComponent, DEFAULT_CONTRACT_STATUS_REFRESH_INTERVAL_MS } from '../../src/ports/contract-status/component'
import { IContractStatusComponent } from '../../src/ports/contract-status/types'
import { IPgComponent } from '../../src/ports/db/types'
import { createTestLogsComponent, createTestPgComponent } from '../components'

const START_OPTIONS = {} as IBaseComponent.ComponentStartOptions

describe('when using the contract status component', () => {
  let contractStatus: IContractStatusComponent
  let dappsDatabase: IPgComponent
  let queryMock: jest.Mock
  let errorMock: jest.Mock
  let refreshIntervalMs: number | undefined

  beforeEach(async () => {
    jest.useFakeTimers()
    queryMock = jest.fn()
    errorMock = jest.fn()
    refreshIntervalMs = undefined
    dappsDatabase = createTestPgComponent({ query: queryMock })
  })

  afterEach(async () => {
    await contractStatus[STOP_COMPONENT]?.()
    jest.useRealTimers()
  })

  async function create(): Promise<IContractStatusComponent> {
    return createContractStatusComponent({
      dappsDatabase,
      config: { getNumber: jest.fn().mockResolvedValue(refreshIntervalMs) } as never,
      logs: createTestLogsComponent({
        getLogger: jest.fn().mockReturnValue({ error: errorMock, info: jest.fn(), warn: jest.fn(), debug: jest.fn() })
      })
    })
  }

  describe('and it has not started', () => {
    beforeEach(async () => {
      contractStatus = await create()
    })

    it('should report no paused contracts', () => {
      expect(contractStatus.getPausedContracts()).toEqual([])
    })
  })

  describe('and the indexer reports no paused contract', () => {
    beforeEach(async () => {
      queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 })
      contractStatus = await create()
      await contractStatus[START_COMPONENT]?.(START_OPTIONS)
    })

    it('should report an empty paused set', () => {
      expect(contractStatus.getPausedContracts()).toEqual([])
    })
  })

  describe('and the indexer reports paused contracts', () => {
    beforeEach(async () => {
      queryMock.mockResolvedValueOnce({
        rows: [
          { address: '0xABC', network: 'POLYGON' },
          { address: '0xdef', network: 'ETHEREUM' }
        ],
        rowCount: 2
      })
      contractStatus = await create()
      await contractStatus[START_COMPONENT]?.(START_OPTIONS)
    })

    it('should load them on start with lowercased addresses and the trades network spelling', () => {
      expect(contractStatus.getPausedContracts()).toEqual([
        { address: '0xabc', network: 'MATIC' },
        { address: '0xdef', network: 'ETHEREUM' }
      ])
    })

    it('should report a paused contract by any address casing on its own network only', () => {
      expect([
        contractStatus.isPaused('0xAbC', 'MATIC'),
        contractStatus.isPaused('0xabc', 'ETHEREUM'),
        contractStatus.isPaused('0xdef', 'ETHEREUM')
      ]).toEqual([true, false, true])
    })

    describe('and a contract is unpaused before the next refresh', () => {
      beforeEach(async () => {
        queryMock.mockResolvedValueOnce({ rows: [{ address: '0xdef', network: 'ETHEREUM' }], rowCount: 1 })
        await jest.advanceTimersByTimeAsync(DEFAULT_CONTRACT_STATUS_REFRESH_INTERVAL_MS)
      })

      it('should drop it from the paused set', () => {
        expect(contractStatus.getPausedContracts()).toEqual([{ address: '0xdef', network: 'ETHEREUM' }])
      })
    })

    describe('and the next refresh fails', () => {
      beforeEach(async () => {
        queryMock.mockRejectedValueOnce(new Error('connection lost'))
        await jest.advanceTimersByTimeAsync(DEFAULT_CONTRACT_STATUS_REFRESH_INTERVAL_MS)
      })

      it('should keep the last known paused set', () => {
        expect(contractStatus.getPausedContracts()).toEqual([
          { address: '0xabc', network: 'MATIC' },
          { address: '0xdef', network: 'ETHEREUM' }
        ])
      })

      it('should log the failure', () => {
        expect(errorMock).toHaveBeenCalledWith(
          expect.stringContaining('keeping the last known set'),
          expect.objectContaining({ error: 'connection lost' })
        )
      })
    })

    describe('and it is stopped', () => {
      beforeEach(async () => {
        await contractStatus[STOP_COMPONENT]?.()
        await jest.advanceTimersByTimeAsync(DEFAULT_CONTRACT_STATUS_REFRESH_INTERVAL_MS * 3)
      })

      it('should not refresh again', () => {
        expect(queryMock).toHaveBeenCalledTimes(1)
      })
    })
  })

  describe('and a refresh interval is configured', () => {
    beforeEach(async () => {
      refreshIntervalMs = 1000
      queryMock.mockResolvedValue({ rows: [], rowCount: 0 })
      contractStatus = await create()
      await contractStatus[START_COMPONENT]?.(START_OPTIONS)
      await jest.advanceTimersByTimeAsync(2000)
    })

    it('should refresh on that interval', () => {
      expect(queryMock).toHaveBeenCalledTimes(3)
    })
  })

  describe('and the first load fails', () => {
    beforeEach(async () => {
      queryMock.mockRejectedValueOnce(new Error('relation does not exist'))
      contractStatus = await create()
      await contractStatus[START_COMPONENT]?.(START_OPTIONS)
    })

    it('should start with an empty paused set instead of failing', () => {
      expect(contractStatus.getPausedContracts()).toEqual([])
    })
  })
})
