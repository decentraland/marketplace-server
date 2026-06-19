import { Network } from '@dcl/schemas'
import { getManaTransfersHandler } from '../../src/controllers/handlers/mana-transfers-handler'
import { IManaTransfersComponent, ManaTransfer, ManaTransferStatus, ManaTransferType } from '../../src/ports/mana-transfers/types'
import { StatusCode } from '../../src/types'

const USER = '0xd9b96b5dc720fc52bede1ec3b40a930e15f70ddd'

let getManaTransfers: jest.MockedFn<IManaTransfersComponent['getManaTransfers']>
let manaTransfers: IManaTransfersComponent

const buildContext = (address: string) =>
  ({
    components: { manaTransfers },
    params: { address }
  } as Parameters<typeof getManaTransfersHandler>[0])

beforeEach(() => {
  getManaTransfers = jest.fn()
  manaTransfers = { getManaTransfers }
})

afterEach(() => {
  jest.resetAllMocks()
})

describe('when the address is invalid', () => {
  it('should respond 400 without querying the component', async () => {
    const response = await getManaTransfersHandler(buildContext('not-an-address'))
    expect(response.status).toBe(StatusCode.BAD_REQUEST)
    expect(response.body).toEqual({ ok: false, message: 'Invalid address' })
    expect(getManaTransfers).not.toHaveBeenCalled()
  })
})

describe('when the address is valid', () => {
  let transfers: ManaTransfer[]

  beforeEach(() => {
    transfers = [
      {
        hash: '0xdep',
        type: ManaTransferType.SWAP,
        network: Network.ETHEREUM,
        from: USER,
        to: '0x40ec5b33f54e0e8a33a975908c5ba1c14e5bbbdf',
        amount: '306.0',
        value: '306000000000000000000',
        timestamp: 1000,
        status: ManaTransferStatus.CONFIRMED,
        counterpartHash: '0xcre'
      }
    ]
    getManaTransfers.mockResolvedValue({ data: transfers, total: 1 })
  })

  it('should respond 200 with the transfer feed and total', async () => {
    const response = await getManaTransfersHandler(buildContext(USER))
    expect(response.status).toBe(StatusCode.OK)
    expect(response.body).toEqual({ data: transfers, total: 1 })
  })

  it('should pass the address to the component', async () => {
    await getManaTransfersHandler(buildContext(USER))
    expect(getManaTransfers).toHaveBeenCalledWith(USER)
  })
})

describe('when the component throws', () => {
  it('should surface a generic message and 500 with an Error', async () => {
    getManaTransfers.mockRejectedValue(new Error('rpc exploded'))
    const response = await getManaTransfersHandler(buildContext(USER))
    expect(response.status).toBe(StatusCode.INTERNAL_SERVER_ERROR)
    expect(response.body).toEqual({ ok: false, message: 'rpc exploded' })
  })

  it('should fall back to a default message on a non-error throw', async () => {
    getManaTransfers.mockRejectedValue('boom')
    const response = await getManaTransfersHandler(buildContext(USER))
    expect(response.status).toBe(StatusCode.INTERNAL_SERVER_ERROR)
    expect(response.body).toEqual({ ok: false, message: 'Could not fetch MANA transfers' })
  })
})
