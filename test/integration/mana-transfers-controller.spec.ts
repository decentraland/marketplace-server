import { Network } from '@dcl/schemas'
import { ManaTransfer, ManaTransferStatus, ManaTransferType } from '../../src/ports/mana-transfers/types'
import { test } from '../components'

test('when getting MANA transfers for a wallet', function ({ components, spyComponents }) {
  const address = '0xd9b96b5dc720fc52bede1ec3b40a930e15f70ddd'

  describe('and the address is not a valid wallet address', () => {
    it('should respond with a 400 and not query the component', async () => {
      const { localFetch } = components
      spyComponents.manaTransfers.getManaTransfers

      const response = await localFetch.fetch('/v1/wallets/not-an-address/mana-transfers')

      expect(response.status).toEqual(400)
      expect(await response.json()).toEqual({ ok: false, message: 'Invalid address' })
      expect(spyComponents.manaTransfers.getManaTransfers).not.toHaveBeenCalled()
    })
  })

  describe('and the address is valid', () => {
    let transfers: ManaTransfer[]

    beforeEach(() => {
      transfers = [
        {
          hash: '0xdep',
          type: ManaTransferType.SWAP,
          network: Network.ETHEREUM,
          from: address,
          to: '0x40ec5b33f54e0e8a33a975908c5ba1c14e5bbbdf',
          amount: '306.0',
          value: '306000000000000000000',
          timestamp: 1000,
          status: ManaTransferStatus.CONFIRMED,
          counterpartHash: '0xcre'
        }
      ]
      spyComponents.manaTransfers.getManaTransfers.mockResolvedValueOnce({ data: transfers, total: 1 })
    })

    it('should respond with a 200 and the transfer feed', async () => {
      const { localFetch } = components

      const response = await localFetch.fetch(`/v1/wallets/${address}/mana-transfers`)

      expect(response.status).toEqual(200)
      expect(await response.json()).toEqual({ data: transfers, total: 1 })
      expect(spyComponents.manaTransfers.getManaTransfers).toHaveBeenCalledWith(address)
    })
  })

  describe('and the component fails to fetch the transfers', () => {
    beforeEach(() => {
      spyComponents.manaTransfers.getManaTransfers.mockRejectedValueOnce(new Error('RPC unavailable'))
    })

    it('should respond with a 500', async () => {
      const { localFetch } = components

      const response = await localFetch.fetch(`/v1/wallets/${address}/mana-transfers`)

      expect(response.status).toEqual(500)
      expect(await response.json()).toEqual({ ok: false, message: 'RPC unavailable' })
    })
  })
})
