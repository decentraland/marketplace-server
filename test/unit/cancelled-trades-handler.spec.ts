import { getCancelledTradesHandler } from '../../src/controllers/handlers/cancelled-trades-handler'
import { TradeCancellationReason } from '../../src/ports/cancelled-trades/types'
import { HandlerContextWithPath, StatusCode } from '../../src/types'

const SIGNER = '0x1111111111111111111111111111111111111111'
const REASON = TradeCancellationReason.CONTRACT_SIGNATURE_INDEX_BUMP

type Context = Pick<HandlerContextWithPath<'cancelledTrades', '/v1/cancelled-trades'>, 'components' | 'url' | 'verification'>

let getCancelledTrades: jest.Mock
let context: Context

function withRequest(query: string, signer: string | undefined = SIGNER.toUpperCase().replace('0X', '0x')) {
  context = {
    components: { cancelledTrades: { getCancelledTrades } },
    url: new URL(`http://example.com/v1/cancelled-trades?${query}`),
    verification: signer ? { auth: signer, authMetadata: {} } : undefined
  }
}

beforeEach(() => {
  getCancelledTrades = jest.fn().mockResolvedValue({ data: [], total: 0 })
})

describe('when getting the cancelled trades of the signer', () => {
  describe('and only the reason is given', () => {
    beforeEach(() => {
      withRequest(`reason=${REASON}`)
    })

    it('should read the first page of twenty for the lowercased signer', async () => {
      expect(await getCancelledTradesHandler(context)).toEqual({ status: StatusCode.OK, body: { data: [], total: 0 } })
      expect(getCancelledTrades).toHaveBeenCalledWith({ signer: SIGNER, reason: REASON, first: 20, skip: 0 })
    })
  })

  describe('and a page larger than allowed is asked for', () => {
    beforeEach(() => {
      withRequest(`reason=${REASON}&first=500&skip=40`)
    })

    it('should cap the page size', async () => {
      await getCancelledTradesHandler(context)

      expect(getCancelledTrades).toHaveBeenCalledWith({ signer: SIGNER, reason: REASON, first: 100, skip: 40 })
    })
  })

  describe('and a single trade type is asked for', () => {
    beforeEach(() => {
      withRequest(`reason=${REASON}&type=bid`)
    })

    it('should read only that type', async () => {
      await getCancelledTradesHandler(context)

      expect(getCancelledTrades).toHaveBeenCalledWith({ signer: SIGNER, reason: REASON, types: ['bid'], first: 20, skip: 0 })
    })
  })

  describe('and two trade types are asked for', () => {
    beforeEach(() => {
      withRequest(`reason=${REASON}&type=public_nft_order&type=public_item_order`)
    })

    it('should read both types', async () => {
      await getCancelledTradesHandler(context)

      expect(getCancelledTrades).toHaveBeenCalledWith({
        signer: SIGNER,
        reason: REASON,
        types: ['public_nft_order', 'public_item_order'],
        first: 20,
        skip: 0
      })
    })
  })

  describe('and the request is not signed', () => {
    beforeEach(() => {
      withRequest(`reason=${REASON}`, '')
    })

    it('should respond with an unauthorized without reading', async () => {
      expect((await getCancelledTradesHandler(context)).status).toBe(StatusCode.UNAUTHORIZED)
      expect(getCancelledTrades).not.toHaveBeenCalled()
    })
  })

  describe.each([
    '',
    'reason=expired',
    `reason=${REASON}&first=0`,
    `reason=${REASON}&skip=-1`,
    `reason=${REASON}&first=abc`,
    `reason=${REASON}&type=bid&type=listing`
  ])('and the query is %s', query => {
    beforeEach(() => {
      withRequest(query)
    })

    it('should respond with a bad request without reading', async () => {
      expect((await getCancelledTradesHandler(context)).status).toBe(StatusCode.BAD_REQUEST)
      expect(getCancelledTrades).not.toHaveBeenCalled()
    })
  })
})
