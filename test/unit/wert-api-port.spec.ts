import { IFetchComponent } from '@well-known-components/http-server'
import { IConfigComponent } from '@well-known-components/interfaces'
import { createWertApi } from '../../src/ports/wert/api/component'
import { WertSession } from '../../src/ports/wert/api/types'
import { Target } from '../../src/ports/wert/types'

describe('createWertApi', () => {
  const apiUrl = 'https://api.wert.io'
  const privateKey = 'myPrivateKey'
  const publicationFeesPrivateKey = 'myPublicationFeesPrivateKey'

  let config: jest.Mocked<IConfigComponent>
  let mockedFetch: jest.Mock
  let fetch: jest.Mocked<IFetchComponent>

  beforeEach(() => {
    config = {
      requireString: jest.fn(),
      getString: jest.fn(),
      getNumber: jest.fn(),
      requireNumber: jest.fn()
    }
    mockedFetch = jest.fn()
    fetch = {
      fetch: mockedFetch
    }
    config.requireString.mockImplementation((key: string) => {
      switch (key) {
        case 'WERT_API_URL':
          return Promise.resolve(apiUrl)
        case 'WERT_PRIVATE_KEY':
          return Promise.resolve(privateKey)
        case 'WERT_PUBLICATION_FEES_PRIVATE_KEY':
          return Promise.resolve(publicationFeesPrivateKey)
        default:
          return Promise.reject(new Error(`Unknown config key: ${key}`))
      }
    })
  })

  describe('createSession', () => {
    let wertApi: Awaited<ReturnType<typeof createWertApi>>
    let wertSession: WertSession
    let expectedResponse: { sessionId: string }

    beforeEach(async () => {
      wertApi = await createWertApi({ config, fetch })
      wertSession = {
        flow_type: 'simple',
        wallet_address: 'myAddress'
      }
      expectedResponse = { sessionId: 'mySessionId' }
    })

    describe('when the app call succeeds', () => {
      beforeEach(() => {
        mockedFetch.mockResolvedValueOnce({
          json: () => Promise.resolve(expectedResponse)
        })
      })

      describe('and the target is undefined', () => {
        it('should create a session using the private key', async () => {
          const response = await wertApi.createSession(wertSession)

          expect(mockedFetch).toHaveBeenCalledWith(`${apiUrl}/create-session`, {
            method: 'POST',
            headers: {
              'x-api-key': privateKey,
              'content-type': 'application/json'
            },
            body: JSON.stringify(wertSession)
          })
          expect(response).toEqual(expectedResponse)
        })
      })

      describe('and the target is default', () => {
        it('should create a session using the private key', async () => {
          const response = await wertApi.createSession(wertSession, Target.DEFAULT)

          expect(mockedFetch).toHaveBeenCalledWith(`${apiUrl}/create-session`, {
            method: 'POST',
            headers: {
              'x-api-key': privateKey,
              'content-type': 'application/json'
            },
            body: JSON.stringify(wertSession)
          })
          expect(response).toEqual(expectedResponse)
        })
      })

      describe('and the target is publicationFees', () => {
        it('should create a session using the publication fees private key', async () => {
          const response = await wertApi.createSession(wertSession, Target.PUBLICATION_FEES)

          expect(mockedFetch).toHaveBeenCalledWith(`${apiUrl}/create-session`, {
            method: 'POST',
            headers: {
              'x-api-key': publicationFeesPrivateKey,
              'content-type': 'application/json'
            },
            body: JSON.stringify(wertSession)
          })
          expect(response).toEqual(expectedResponse)
        })
      })
    })

    describe('when the API call fails', () => {
      beforeEach(() => {
        fetch.fetch.mockRejectedValueOnce(new Error('API Error'))
      })

      it('should propagate the error', async () => {
        await expect(wertApi.createSession(wertSession)).rejects.toThrow('API Error')
      })
    })
  })
})
