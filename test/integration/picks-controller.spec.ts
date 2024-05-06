import nock from 'nock'
import { TPick } from '../../src/adapters/picks'
import { DEFAULT_LIST_ID } from '../../src/migrations/favorites/1678303321034_default-list'
import { HTTPResponse } from '../../src/types'
import { test } from '../components'

test('picks controller', function ({ components }) {
  const { config, items } = components
  beforeAll(async () => {
    const snapshotUrl = await config.requireString('SNAPSHOT_URL')

    nock(snapshotUrl)
      .post(/.*/)
      .reply(200, { result: { vp: 1 } })
  })

  beforeEach(async () => {
    ;(items.validateItemExists as jest.Mock).mockImplementation(() => Promise.resolve(true))
    await components.favoritesDatabase.query('TRUNCATE TABLE favorites.picks')
  })

  describe('when making a request to GET /v1/picks/:itemId', () => {
    let itemId: string
    let userAddress: string
    let expectedResponse: HTTPResponse<Pick<TPick, 'userAddress'>>['body']

    beforeEach(() => {
      itemId = '0x08de0de733cc11081d43569b809c00e6ddf314fb-0'
      userAddress = '0x1dec5f50cb1467f505bb3ddfd408805114406b10'
    })

    describe('and there are no picks in the db', () => {
      beforeEach(() => {
        expectedResponse = {
          ok: true,
          data: { limit: 100, page: 0, pages: 0, results: [], total: 0 }
        }
      })

      it('responds with an empty array of picks for the given item id', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch(`/v1/picks/${itemId}`)

        expect(response.status).toEqual(200)
        expect(await response.json()).toEqual(expectedResponse)
      })
    })

    describe('and there are some picks in the db', () => {
      beforeEach(async () => {
        const { lists } = components

        await lists.addPickToList(DEFAULT_LIST_ID, itemId, userAddress)

        expectedResponse = {
          ok: true,
          data: { limit: 100, page: 0, pages: 1, results: [{ userAddress }], total: 1 }
        }
      })

      it('responds with the an array with the recently created pick for the given item id', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch(`/v1/picks/${itemId}`)

        expect(response.status).toEqual(200)
        expect(await response.json()).toEqual(expectedResponse)
      })
    })
  })
})
