import {
  CREATOR_SEARCH_DEFAULT_LIMIT,
  CREATOR_SEARCH_MAX_LIMIT,
  CreatorSearchRow,
  getCreatorSearchQuery,
  parseCatalystProfiles,
  refreshCreatorProfiles
} from '../../logic/catalog/creator-profiles'
import { AppComponents } from '../../types'
import { clampCount } from '../shop-catalog/component'
import {
  CREATOR_PROFILES_LOOKUP_TIMEOUT_MS,
  CreatorSearchFilters,
  CreatorSearchHit,
  DEFAULT_PEER_URL,
  ICreatorProfilesComponent
} from './types'

export async function createCreatorProfilesComponent(
  components: Pick<AppComponents, 'config' | 'logs' | 'fetch' | 'dappsDatabase' | 'dappsWriteDatabase'>
): Promise<ICreatorProfilesComponent> {
  const { config, logs, fetch, dappsDatabase, dappsWriteDatabase } = components
  const logger = logs.getLogger('creator-profiles')
  const peerUrl = ((await config.getString('PEER_URL')) || DEFAULT_PEER_URL).replace(/\/+$/, '')

  async function fetchProfiles(addresses: string[]) {
    const response = await fetch.fetch(`${peerUrl}/lambdas/profiles`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ ids: addresses }),
      signal: AbortSignal.timeout(CREATOR_PROFILES_LOOKUP_TIMEOUT_MS)
    })
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      throw new Error(`Catalyst answered ${response.status}`)
    }
    return parseCatalystProfiles(await response.json())
  }

  async function refresh() {
    const result = await refreshCreatorProfiles({
      connect: () => dappsWriteDatabase.getPool().connect(),
      fetchProfiles,
      logger
    })
    if (result.outcome === 'refreshed') {
      logger.info(`Refreshed ${result.creators} creator profiles: ${result.lookedUp} looked up, ${result.failedBatches} batches failed`)
    }
    return result
  }

  async function search(filters: CreatorSearchFilters): Promise<{ data: CreatorSearchHit[] }> {
    const first = clampCount(filters.first, CREATOR_SEARCH_DEFAULT_LIMIT, 1, CREATOR_SEARCH_MAX_LIMIT)
    const search = filters.search.trim()
    if (!search) return { data: [] }
    const result = await dappsDatabase.query<CreatorSearchRow>(getCreatorSearchQuery(search, first))
    return {
      data: result.rows.map(row => ({ address: row.address, name: row.name, face: row.face, items: Number(row.items) }))
    }
  }

  return { refresh, search }
}
