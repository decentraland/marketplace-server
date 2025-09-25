import { AppComponents } from '../../../types'
import { IWertApiComponent, WertSession, WertSessionResponse } from './types'

export async function createWertApi({ config, fetch }: Pick<AppComponents, 'config' | 'fetch'>): Promise<IWertApiComponent> {
  const [apiUrl, apiKey] = await Promise.all([config.requireString('WERT_API_URL'), config.requireString('WERT_API_KEY')])

  async function createSession(session: WertSession): Promise<WertSessionResponse> {
    const response = await fetch.fetch(`${apiUrl}/create-session`, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'content-type': 'application/json'
      },
      body: JSON.stringify(session)
    })

    const data = await response.json()
    return data
  }

  return {
    createSession
  }
}
