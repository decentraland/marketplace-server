import { createConfigComponent, createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { IConfigComponent, IDatabase, ILoggerComponent, IMetricsComponent } from '@well-known-components/interfaces'
import { createTestMetricsComponent } from '@well-known-components/metrics'
import * as BasePgComponent from '@well-known-components/pg-component'
import { metricDeclarations } from '../../src/metrics'
import { createPgComponent } from '../../src/ports/db/component'
import { IPgComponent } from '../../src/ports/db/types'
import { createTestLogsComponent, createTestPgComponent } from '../components'

let dbQueryMock: jest.Mock
let dbClientQueryMock: jest.Mock
let dbClientReleaseMock: jest.Mock
let pg: IPgComponent & IDatabase
let logs: ILoggerComponent
let config: IConfigComponent
let metrics: IMetricsComponent<keyof typeof metricDeclarations>

beforeEach(async () => {
  dbQueryMock = jest.fn()
  dbClientQueryMock = jest.fn()
  dbClientReleaseMock = jest.fn().mockResolvedValue(undefined)

  jest.spyOn(BasePgComponent, 'createPgComponent').mockImplementation(async () =>
    createTestPgComponent({
      query: dbQueryMock,
      getPool: jest.fn().mockReturnValue({
        connect: () => ({
          query: dbClientQueryMock,
          release: dbClientReleaseMock
        })
      })
    })
  )

  logs = createTestLogsComponent({
    getLogger: jest.fn().mockReturnValue({ error: () => undefined, info: () => undefined })
  })
  config = await createDotEnvConfigComponent({ path: ['.env.default', '.env.spec', '.env'] })
  metrics = createTestMetricsComponent({})

  pg = await createPgComponent({ config, logs, metrics }, { dbPrefix: 'FAVORITES' })
})

describe('when executing db queries inside a transaction', () => {
  beforeEach(() => {
    // Begin Query
    dbClientQueryMock.mockResolvedValueOnce(undefined)
  })

  describe('and the query is successful', () => {
    beforeEach(async () => {
      await pg.withTransaction(jest.fn())
    })

    it('should execute BEGIN statement to start the transaction', () => {
      expect(dbClientQueryMock).toHaveBeenCalledWith('BEGIN')
    })

    it('should execute the COMMIT statement to finish the successful transaction', () => {
      expect(dbClientQueryMock).toHaveBeenCalledWith('COMMIT')
    })

    it('should release the client', () => {
      expect(dbClientReleaseMock).toHaveBeenCalled()
    })
  })

  describe('and the query is unsuccessful', () => {
    beforeEach(async () => {
      expect(
        pg.withTransaction(() => {
          throw new Error('Unexpected error')
        })
      ).rejects.toEqual(new Error('Unexpected error'))
    })

    it('should execute BEGIN statement to start the transaction', () => {
      expect(dbClientQueryMock).toHaveBeenCalledWith('BEGIN')
    })

    it('should execute the ROLLBACK statement to return to the previous state in the db', () => {
      expect(dbClientQueryMock).not.toHaveBeenCalledWith('COMMIT')
      expect(dbClientQueryMock).toHaveBeenCalledWith('ROLLBACK')
    })

    it('should release the client', () => {
      expect(dbClientReleaseMock).toHaveBeenCalled()
    })
  })
})
