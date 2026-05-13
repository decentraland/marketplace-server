/* eslint-disable @typescript-eslint/unbound-method */
import { URL } from 'url'
import { Network } from '@dcl/schemas'
import { getActivityHandler } from '../../src/controllers/handlers/activity-handler'
import { ActivityEvent, ActivityEventType } from '../../src/ports/activity/types'
import { HandlerContextWithPath, StatusCode } from '../../src/types'

const makeLogs = (logger: { error: jest.Mock; warn?: jest.Mock; info?: jest.Mock; debug?: jest.Mock; log?: jest.Mock }) => ({
  getLogger: jest.fn().mockReturnValue({
    error: logger.error,
    warn: logger.warn ?? jest.fn(),
    info: logger.info ?? jest.fn(),
    debug: logger.debug ?? jest.fn(),
    log: logger.log ?? jest.fn()
  })
})

describe('when fetching the user activity', () => {
  let context: Pick<HandlerContextWithPath<'activity' | 'logs', '/v1/activity'>, 'components' | 'url' | 'verification'>
  let getUserActivityMock: jest.Mock
  let errorLog: jest.Mock
  let events: ActivityEvent[]

  beforeEach(() => {
    events = [
      {
        id: 'sale_buyer:1',
        type: ActivityEventType.SALE_BUYER,
        timestamp: 1000,
        network: Network.MATIC,
        txHash: '0xabc',
        contractAddress: '0xcontract',
        tokenId: '1',
        price: '100',
        counterparty: '0xseller',
        details: {} as any
      }
    ]
    getUserActivityMock = jest.fn().mockResolvedValue({ data: events, total: 1 })
    errorLog = jest.fn()
    context = {
      url: new URL('http://localhost:3000/v1/activity'),
      components: {
        activity: { getUserActivity: getUserActivityMock },
        logs: makeLogs({ error: errorLog })
      },
      verification: { auth: '0xUSER', authMetadata: {} }
    }
  })

  describe('and the request is not signed', () => {
    beforeEach(() => {
      context.verification = undefined
    })

    it('should respond with 401', async () => {
      const result = await getActivityHandler(context)
      expect(result.status).toBe(StatusCode.UNAUTHORIZED)
      expect(result.body).toEqual({ ok: false, message: 'Unauthorized' })
      expect(getUserActivityMock).not.toHaveBeenCalled()
    })
  })

  describe('and the request is signed', () => {
    it('should call the activity component with the lowercased address and no paging params', async () => {
      await getActivityHandler(context)
      expect(getUserActivityMock).toHaveBeenCalledWith('0xuser', { limit: undefined, offset: undefined })
    })

    it('should respond with 200 and the aggregated events (no ok envelope, matching sales/orders shape)', async () => {
      const result = await getActivityHandler(context)
      expect(result).toEqual({
        status: StatusCode.OK,
        body: { data: events, total: 1 }
      })
    })
  })

  describe('and a ?limit query parameter is provided', () => {
    beforeEach(() => {
      context.url = new URL('http://localhost:3000/v1/activity?limit=25')
    })

    it('should forward the limit to the activity component', async () => {
      await getActivityHandler(context)
      expect(getUserActivityMock).toHaveBeenCalledWith('0xuser', { limit: 25, offset: undefined })
    })
  })

  describe('and ?offset is provided', () => {
    beforeEach(() => {
      context.url = new URL('http://localhost:3000/v1/activity?limit=20&offset=40')
    })

    it('should forward both limit and offset', async () => {
      await getActivityHandler(context)
      expect(getUserActivityMock).toHaveBeenCalledWith('0xuser', { limit: 20, offset: 40 })
    })
  })

  describe('and the activity component throws', () => {
    beforeEach(() => {
      getUserActivityMock.mockRejectedValueOnce(new Error('connection refused to db.internal'))
    })

    it('should respond with 500 and a generic message (do not leak internals)', async () => {
      const result = await getActivityHandler(context)
      expect(result).toEqual({
        status: StatusCode.ERROR,
        body: { ok: false, message: 'Could not fetch activity' }
      })
    })

    it('should log the underlying error server-side', async () => {
      await getActivityHandler(context)
      expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('connection refused to db.internal'))
    })
  })
})
