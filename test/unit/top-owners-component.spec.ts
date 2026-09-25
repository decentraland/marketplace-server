import { ILoggerComponent } from '@well-known-components/interfaces'
import { ICacheStorageComponent } from '@dcl/core-commons'
import { IPgComponent } from '../../src/ports/db/types'
import { createOwnersComponent, TOP_OWNERS_CACHE_TTL_SECONDS } from '../../src/ports/owners/component'
import { TopOwnersTimeoutError } from '../../src/ports/owners/errors'
import { IOwnersComponent } from '../../src/ports/owners/types'
import { createTestLogsComponent, createTestPgComponent } from '../components'

const CREATOR = '0x1111111111111111111111111111111111111111'
const row = { owner: '0xa', nfts: '2', items: '1', collections: '1', last_at: '1700000000', spent: '5' }

let owners: IOwnersComponent
let logs: ILoggerComponent
let dappsDatabase: IPgComponent
let cache: ICacheStorageComponent
let queryMock: jest.Mock
let cacheGet: jest.Mock
let cacheSet: jest.Mock
let releaseMock: jest.Mock

beforeEach(() => {
  logs = createTestLogsComponent({
    getLogger: jest.fn().mockReturnValue({ error: () => undefined, info: () => undefined, warn: () => undefined })
  })
  queryMock = jest.fn()
  releaseMock = jest.fn()
  dappsDatabase = createTestPgComponent({
    getPool: jest.fn().mockReturnValue({ connect: () => ({ query: queryMock, release: releaseMock }) })
  })
  cacheGet = jest.fn().mockResolvedValue(null)
  cacheSet = jest.fn().mockResolvedValue(undefined)
  cache = { get: cacheGet, set: cacheSet } as unknown as ICacheStorageComponent
  owners = createOwnersComponent({ dappsDatabase, logs, cache })
})

describe('when fetching the top owners of a creator', () => {
  describe('and they are not cached', () => {
    beforeEach(() => {
      queryMock.mockImplementation((query: unknown) => Promise.resolve(typeof query === 'string' ? {} : { rows: [row] }))
    })

    it('should aggregate them under a statement timeout and cache the result', async () => {
      const result = await owners.fetchTopOwners({ creator: CREATOR.toUpperCase().replace('0X', '0x') })

      expect(result).toEqual({
        data: [{ address: '0xa', nfts: 2, items: 1, collections: 1, lastAcquiredAt: 1_700_000_000_000, spentWei: '5' }],
        total: 1
      })
      expect(queryMock).toHaveBeenCalledWith(expect.stringContaining('SET LOCAL statement_timeout'))
      expect(cacheSet).toHaveBeenCalledWith(`top-owners:${CREATOR}`, result.data, TOP_OWNERS_CACHE_TTL_SECONDS)
      expect(releaseMock).toHaveBeenCalled()
    })
  })

  describe('and they are cached', () => {
    beforeEach(() => {
      cacheGet.mockResolvedValue([{ address: '0xa', nfts: 1, items: 1, collections: 1, lastAcquiredAt: 1, spentWei: '0' }])
    })

    it('should not query the database', async () => {
      await owners.fetchTopOwners({ creator: CREATOR })

      expect(queryMock).not.toHaveBeenCalled()
    })
  })

  describe('and the aggregate runs past the timeout', () => {
    beforeEach(() => {
      queryMock.mockImplementation((query: unknown) =>
        typeof query === 'string' ? Promise.resolve({}) : Promise.reject(Object.assign(new Error('canceling statement'), { code: '57014' }))
      )
    })

    it('should roll back, release the connection and throw a timeout error', async () => {
      await expect(owners.fetchTopOwners({ creator: CREATOR })).rejects.toBeInstanceOf(TopOwnersTimeoutError)
      expect(queryMock).toHaveBeenCalledWith('ROLLBACK')
      expect(releaseMock).toHaveBeenCalled()
      expect(cacheSet).not.toHaveBeenCalled()
    })
  })

  describe('and the rollback itself fails', () => {
    let rollbackError: Error

    beforeEach(() => {
      rollbackError = new Error('connection lost')
      queryMock.mockImplementation((query: unknown) => {
        if (query === 'ROLLBACK') return Promise.reject(rollbackError)
        return typeof query === 'string' ? Promise.resolve({}) : Promise.reject(new Error('boom'))
      })
    })

    it('should release the connection with the error so the pool discards it', async () => {
      await expect(owners.fetchTopOwners({ creator: CREATOR })).rejects.toThrow('boom')
      expect(releaseMock).toHaveBeenCalledWith(rollbackError)
    })
  })

  describe('and the cache cannot be reached', () => {
    beforeEach(() => {
      cacheGet.mockRejectedValue(new Error('redis down'))
      cacheSet.mockRejectedValue(new Error('redis down'))
      queryMock.mockImplementation((query: unknown) => Promise.resolve(typeof query === 'string' ? {} : { rows: [row] }))
    })

    it('should still answer from the database', async () => {
      await expect(owners.fetchTopOwners({ creator: CREATOR })).resolves.toMatchObject({ total: 1 })
    })
  })
})
