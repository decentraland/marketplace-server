import { test } from '../components'

test('when getting owners', function ({ components }) {
  const contractAddress = '0xf87e31492faf9a91b02ee0deaad50d51d56d5d4d'
  const itemId = '0'

  describe('and no owners exist for the contract and item', () => {
    it('should respond with a 200 and an empty array of owners', async () => {
      const { localFetch } = components
      const response = await localFetch.fetch(`/v1/owners?contractAddress=${contractAddress}&itemId=${itemId}`)
      const responseBody = await response.json()
      expect(response.status).toEqual(200)
      expect(responseBody).toEqual({ data: [], total: 0 })
    })
  })

  describe('when missing required parameters', () => {
    it('should respond with a 400 when contractAddress is missing', async () => {
      const { localFetch } = components
      const response = await localFetch.fetch(`/v1/owners?itemId=${itemId}`)
      const responseBody = await response.json()
      expect(response.status).toEqual(400)
      expect(responseBody).toEqual({
        ok: false,
        message: "Couldn't fetch owners with the filters provided"
      })
    })

    it('should respond with a 400 when itemId is missing', async () => {
      const { localFetch } = components
      const response = await localFetch.fetch(`/v1/owners?contractAddress=${contractAddress}`)
      const responseBody = await response.json()
      expect(response.status).toEqual(400)
      expect(responseBody).toEqual({
        ok: false,
        message: "Couldn't fetch owners with the filters provided"
      })
    })

    it('should respond with a 400 when both parameters are missing', async () => {
      const { localFetch } = components
      const response = await localFetch.fetch('/v1/owners')
      const responseBody = await response.json()
      expect(response.status).toEqual(400)
      expect(responseBody).toEqual({
        ok: false,
        message: "Couldn't fetch owners with the filters provided"
      })
    })
  })

  describe('when called with pagination parameters', () => {
    it('should respond with a 200 and handle pagination correctly', async () => {
      const { localFetch } = components
      const response = await localFetch.fetch(
        `/v1/owners?contractAddress=${contractAddress}&itemId=${itemId}&first=10&skip=0&sortBy=issuedId&orderDirection=desc`
      )
      const responseBody = await response.json()
      expect(response.status).toEqual(200)
      expect(responseBody).toEqual(
        expect.objectContaining({
          data: expect.any(Array),
          total: expect.any(Number)
        })
      )
    })
  })
})
