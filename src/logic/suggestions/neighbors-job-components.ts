import { Client as PgClient } from 'pg'
import type { IPgComponent } from '@dcl/pg-component'
import { createPgComponent, resolveConnectionString } from '../../ports/db/component'
import { createDisabledJobComponent, createJobComponent, IJobComponent } from '../../ports/job'
import { createWornNeighborsComponent, IWornNeighborsComponent } from '../../ports/worn-neighbors'
import { AppComponents } from '../../types'
import { NEIGHBORS_REBUILD_INTERVAL_MS, NEIGHBORS_REBUILD_STARTUP_DELAY_MS } from './constants'
import { runNeighborsJob } from './run-neighbors-job'

export type NeighborsJobComponents = {
  rebuildItemNeighborsJob: IJobComponent
  /** Only when the job is enabled: nothing else reads the asset-bundle-registry database. */
  assetBundleRegistryDatabase?: IPgComponent
  wornNeighbors?: IWornNeighborsComponent
}

/**
 * Rebuilds the item-neighbours table behind /v3/catalog/suggested. It runs in this process but on its
 * own short-lived connections: the pooled clients cap every statement at 40 seconds and the acquisition
 * scan alone runs past 80. All three replicas fire on the same schedule; the advisory lock inside the
 * job is what stops them duplicating the work.
 *
 * OFF unless SUGGESTIONS_NEIGHBORS_JOB_ENABLED says otherwise, and off is the default on purpose. The
 * Shop's feature flag hides the RAIL; it has no bearing on this, which would otherwise start rebuilding
 * in production the moment the service deploys, whether or not anyone can see a suggestion. Separating
 * the two is what lets the endpoint ship and be smoke-tested before the heaviest part of the feature is
 * allowed to run. When off, nothing is scheduled and no connection is opened, and the
 * asset-bundle-registry database, which only the co-wear source reads, is neither configured nor
 * connected to.
 */
export async function createNeighborsJobComponents(
  components: Pick<AppComponents, 'config' | 'logs' | 'metrics'>
): Promise<NeighborsJobComponents> {
  const { config, logs, metrics } = components
  const rebuildNeighborsLogger = logs.getLogger('rebuild-item-neighbors-job')

  if ((await config.getString('SUGGESTIONS_NEIGHBORS_JOB_ENABLED')) !== 'true') {
    return { rebuildItemNeighborsJob: createDisabledJobComponent(rebuildNeighborsLogger, 'item neighbours rebuild') }
  }

  const neighborsConnectionStrings = {
    read: await resolveConnectionString(config, 'DAPPS_READ'),
    write: await resolveConnectionString(config, 'DAPPS')
  }

  // Owned by the asset-bundle-registry, so this service never migrates it.
  const assetBundleRegistryDatabase = await createPgComponent(
    { config, logs, metrics },
    {
      dbPrefix: 'ASSET_BUNDLE_REGISTRY',
      migrations: false
    }
  )
  const wornNeighbors = createWornNeighborsComponent({ assetBundleRegistryDatabase })

  const rebuildItemNeighborsJob = createJobComponent(
    { logs },
    () =>
      runNeighborsJob({
        connect: async role => {
          const client = new PgClient({
            connectionString: neighborsConnectionStrings[role],
            application_name: `marketplace-server-neighbors-${role}`
          })
          await client.connect()
          return client
        },
        wornNeighbors,
        logger: rebuildNeighborsLogger,
        metrics: {
          observe: ({ durationMs, rows, peakRssBytes }) => {
            metrics.observe('suggestions_neighbors_build_duration_seconds', {}, durationMs / 1000)
            metrics.observe('suggestions_neighbors_rows', {}, rows)
            metrics.observe('suggestions_neighbors_peak_rss_bytes', {}, peakRssBytes)
          }
        }
      }),
    NEIGHBORS_REBUILD_INTERVAL_MS,
    {
      startupDelay: NEIGHBORS_REBUILD_STARTUP_DELAY_MS,
      onError: error =>
        rebuildNeighborsLogger.error(`Failed to rebuild item neighbours: ${error instanceof Error ? error.message : String(error)}`)
    }
  )

  return { rebuildItemNeighborsJob, assetBundleRegistryDatabase, wornNeighbors }
}
