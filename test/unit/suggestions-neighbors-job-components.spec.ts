import { createConfigComponent } from '@well-known-components/env-config-provider'
import { Lifecycle } from '@well-known-components/interfaces'
import type { IPgComponent } from '@dcl/pg-component'
import { createNeighborsJobComponents, type NeighborsJobComponents } from '../../src/logic/suggestions/neighbors-job-components'
import * as dbComponent from '../../src/ports/db/component'
import type { AppComponents } from '../../src/types'

describe('when wiring the item neighbours rebuild', () => {
  let logs: AppComponents['logs']
  let metrics: AppComponents['metrics']
  let createPgComponentSpy: jest.SpyInstance

  beforeEach(() => {
    const logger = { log: jest.fn(), debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
    logs = { getLogger: () => logger }
    metrics = { observe: jest.fn() } as unknown as AppComponents['metrics']
    createPgComponentSpy = jest.spyOn(dbComponent, 'createPgComponent').mockResolvedValue({} as IPgComponent & never)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('and the job is disabled, with no asset-bundle-registry configuration at all', () => {
    let wired: NeighborsJobComponents

    beforeEach(async () => {
      const config = createConfigComponent({}, { SUGGESTIONS_NEIGHBORS_JOB_ENABLED: 'false' })
      wired = await createNeighborsJobComponents({ config, logs, metrics })
    })

    it('should still wire up, so the service starts without the registry settings', () => {
      expect(wired.rebuildItemNeighborsJob).toBeDefined()
    })

    it('should not create the asset-bundle-registry database', () => {
      expect(createPgComponentSpy).not.toHaveBeenCalled()
    })

    it('should leave the registry database and the co-wear source out of the component tree', () => {
      expect(wired).toEqual({ rebuildItemNeighborsJob: expect.anything() })
    })

    describe('and the component tree is started and stopped with them', () => {
      let lifecycle: Promise<void>

      beforeEach(() => {
        // The lifecycle refuses a key whose value is missing, which is how an `undefined` entry here
        // would fail the service at startup.
        lifecycle = (async () => {
          const program = await Lifecycle.run({
            initComponents: async () => ({ ...wired }),
            main: async ({ startComponents }) => {
              await startComponents()
            }
          })
          await program.stop()
        })()
      })

      it('should start and stop without complaint', async () => {
        await expect(lifecycle).resolves.toBeUndefined()
      })
    })
  })

  describe('and the job is enabled', () => {
    let wired: NeighborsJobComponents

    beforeEach(async () => {
      const config = createConfigComponent(
        {},
        {
          SUGGESTIONS_NEIGHBORS_JOB_ENABLED: 'true',
          DAPPS_PG_COMPONENT_PSQL_CONNECTION_STRING: 'postgres://user:password@localhost:5432/dapps',
          DAPPS_READ_PG_COMPONENT_PSQL_CONNECTION_STRING: 'postgres://user:password@localhost:5432/dapps'
        }
      )
      wired = await createNeighborsJobComponents({ config, logs, metrics })
    })

    it('should create the asset-bundle-registry database without migrating it', () => {
      expect(createPgComponentSpy).toHaveBeenCalledWith(expect.anything(), { dbPrefix: 'ASSET_BUNDLE_REGISTRY', migrations: false })
    })

    it('should expose the registry database so the component tree starts and stops it', () => {
      expect(wired.assetBundleRegistryDatabase).toBeDefined()
    })

    it('should build the co-wear source on it', () => {
      expect(wired.wornNeighbors).toEqual({ getNeighbors: expect.any(Function) })
    })
  })
})
