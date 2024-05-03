import { ChainId } from '@dcl/schemas'
import { isErrorWithMessage } from '../../../logic/errors'
import { AppComponents } from '../../../types'
import { strategiesByChainId } from './constants'
import { ScoreError } from './errors'
import { ISnapshotComponent, ScoreRequest, ScoreResponse } from './types'

export async function createSnapshotComponent(components: Pick<AppComponents, 'fetch' | 'config'>): Promise<ISnapshotComponent> {
  const { fetch, config } = components
  const SNAPSHOT_URL = await config.requireString('SNAPSHOT_URL')
  const SNAPSHOT_NETWORK: ChainId.ETHEREUM_SEPOLIA | ChainId.ETHEREUM_MAINNET = await config.requireNumber('SNAPSHOT_NETWORK')
  const SNAPSHOT_SPACE = await config.requireString('SNAPSHOT_SPACE')
  if (SNAPSHOT_NETWORK !== ChainId.ETHEREUM_SEPOLIA && SNAPSHOT_NETWORK !== ChainId.ETHEREUM_MAINNET) {
    throw new Error(`The snapshot network id was not correctly set to either ${ChainId.ETHEREUM_MAINNET} or ${ChainId.ETHEREUM_SEPOLIA}`)
  }

  async function getScore(address: string): Promise<number> {
    const data: ScoreRequest = {
      jsonrpc: '2.0',
      method: 'get_vp',
      params: {
        network: SNAPSHOT_NETWORK.toString(),
        address: address.toLowerCase(),
        strategies: strategiesByChainId[SNAPSHOT_NETWORK],
        space: SNAPSHOT_SPACE,
        delegation: false
      }
    }

    try {
      const res = await fetch.fetch(SNAPSHOT_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify(data)
      })
      const body: ScoreResponse = await res.json()
      return (body?.result?.vp || 0) | 0
    } catch (err) {
      throw new ScoreError(isErrorWithMessage(err) ? err.message : 'Unknown', address)
    }
  }

  return { getScore }
}
