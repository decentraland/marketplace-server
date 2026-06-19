import { Item } from '@dcl/schemas'
import { test } from '../components'
import { createSquidDBEmoteItem, createSquidDBSale, deleteSquidDBEmoteItem, deleteSquidDBSale } from './utils/dbItems'

test('when fetching trending items', function ({ components }) {
  const contractAddress = '0x4444444444444444444444444444444444444444'
  const socialEmoteItemId = '8001'
  const regularEmoteItemId = '8002'

  describe('and a trending social emote and a trending regular emote exist', () => {
    beforeEach(async () => {
      await createSquidDBEmoteItem(components, { itemId: socialEmoteItemId, contractAddress, outcomeType: 'multiple_outcome' })
      await createSquidDBEmoteItem(components, { itemId: regularEmoteItemId, contractAddress, outcomeType: null })
      await createSquidDBSale(components, { itemId: socialEmoteItemId, contractAddress })
      await createSquidDBSale(components, { itemId: regularEmoteItemId, contractAddress })
    })

    afterEach(async () => {
      await Promise.all([
        deleteSquidDBSale(components, socialEmoteItemId, contractAddress),
        deleteSquidDBSale(components, regularEmoteItemId, contractAddress),
        deleteSquidDBEmoteItem(components, socialEmoteItemId, contractAddress),
        deleteSquidDBEmoteItem(components, regularEmoteItemId, contractAddress)
      ])
    })

    describe('and includeSocialEmotes is not provided', () => {
      let response: Response
      let responseBody: { data: Item[] }
      let returnedIds: string[]

      beforeEach(async () => {
        const { localFetch } = components
        response = await localFetch.fetch('/v1/trendings')
        responseBody = await response.json()
        returnedIds = responseBody.data.map(item => item.id)
      })

      it('should respond with a 200', () => {
        expect(response.status).toEqual(200)
      })

      it('should include the regular emote', () => {
        expect(returnedIds).toContain(`${contractAddress}_${regularEmoteItemId}`)
      })

      it('should include the social emote', () => {
        expect(returnedIds).toContain(`${contractAddress}_${socialEmoteItemId}`)
      })
    })

    describe('and includeSocialEmotes is false', () => {
      let response: Response
      let responseBody: { data: Item[] }
      let returnedIds: string[]

      beforeEach(async () => {
        const { localFetch } = components
        response = await localFetch.fetch('/v1/trendings?includeSocialEmotes=false')
        responseBody = await response.json()
        returnedIds = responseBody.data.map(item => item.id)
      })

      it('should respond with a 200', () => {
        expect(response.status).toEqual(200)
      })

      it('should include the regular emote', () => {
        expect(returnedIds).toContain(`${contractAddress}_${regularEmoteItemId}`)
      })

      it('should not include the social emote', () => {
        expect(returnedIds).not.toContain(`${contractAddress}_${socialEmoteItemId}`)
      })
    })
  })
})
