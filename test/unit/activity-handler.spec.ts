/* eslint-disable @typescript-eslint/unbound-method */
import { Network } from '@dcl/schemas'
import { getActivityHandler } from '../../src/controllers/handlers/activity-handler'
import { ActivityEvent, ActivityEventType } from '../../src/ports/activity/types'
import { HandlerContextWithPath, StatusCode } from '../../src/types'

describe('when fetching the user activity', () => {
  let context: Pick<HandlerContextWithPath<'activity', '/v1/activity'>, 'components' | 'verification'>
  let getUserActivityMock: jest.Mock
  let events: ActivityEvent[]

  beforeEach(() => {
    events = [
      {
        id: 'sale:1',
        type: ActivityEventType.SALE_BUYER,
        timestamp: 1000,
        network: Network.MATIC,
        txHash: '0xabc',
        contractAddress: '0xcontract',
        tokenId: '1',
        itemId: undefined,
        price: '100',
        counterparty: '0xseller',
        details: {} as any
      }
    ]
    getUserActivityMock = jest.fn().mockResolvedValue({ data: events, total: 1 })
    context = {
      components: {
        activity: {
          getUserActivity: getUserActivityMock
        }
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
    it('should call the activity component with the lowercased address', async () => {
      await getActivityHandler(context)
      expect(getUserActivityMock).toHaveBeenCalledWith('0xuser')
    })

    it('should respond with 200 and the aggregated events', async () => {
      const result = await getActivityHandler(context)
      expect(result).toEqual({
        status: StatusCode.OK,
        body: {
          ok: true,
          data: { data: events, total: 1 }
        }
      })
    })
  })

  describe('and the activity component throws', () => {
    beforeEach(() => {
      getUserActivityMock.mockRejectedValueOnce(new Error('boom'))
    })

    it('should respond with 500 and the error message', async () => {
      const result = await getActivityHandler(context)
      expect(result).toEqual({
        status: StatusCode.ERROR,
        body: { ok: false, message: 'boom' }
      })
    })
  })
})
