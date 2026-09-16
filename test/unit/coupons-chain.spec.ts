/* eslint-disable @typescript-eslint/naming-convention */
import { Contract } from 'ethers'
import { ChainId } from '@dcl/schemas'
import { createCouponChainReader } from '../../src/ports/coupons/chain'

jest.mock('ethers', () => ({
  ...jest.requireActual('ethers'),
  JsonRpcProvider: jest.fn(),
  Contract: jest.fn()
}))

const MANAGER = '0x655fdfa91d69ea49f4ce1a8f7f7e2622c8630813'
const DIGEST_SLOT = '0x' + '11'.repeat(32)
const SIGNATURE_SLOT = '0x' + '22'.repeat(32)

/**
 * The deployed managers disagree on which slot a coupon lives in, so the reader asks for both. Only the
 * one that coupon's own manager uses is ever written, which is why the answer is whichever slot holds
 * something rather than, say, their sum.
 */
describe('when reading the on-chain state of a coupon', () => {
  let signatureUses: jest.Mock
  let cancelledSignatures: jest.Mock
  let chain: ReturnType<typeof createCouponChainReader>

  beforeEach(() => {
    signatureUses = jest.fn()
    cancelledSignatures = jest.fn()
    // `resetMocks` wipes implementations between cases, so the manager is rebuilt rather than hoisted.
    ;(Contract as unknown as jest.Mock).mockImplementation(() => ({ signatureUses, cancelledSignatures }))
    chain = createCouponChainReader()
  })

  describe('and the manager keeps the coupon in the second slot', () => {
    beforeEach(() => {
      signatureUses.mockImplementation(async (slot: string) => (slot === SIGNATURE_SLOT ? 3n : 0n))
      cancelledSignatures.mockResolvedValue(false)
    })

    it('should report the uses that slot holds instead of the empty one', async () => {
      await expect(chain.readState(ChainId.MATIC_MAINNET, MANAGER, [DIGEST_SLOT, SIGNATURE_SLOT])).resolves.toEqual({
        uses: 3,
        cancelled: false
      })
    })
  })

  describe('and the coupon was cancelled under one of the slots', () => {
    beforeEach(() => {
      signatureUses.mockResolvedValue(0n)
      cancelledSignatures.mockImplementation(async (slot: string) => slot === DIGEST_SLOT)
    })

    it('should report it as cancelled, since no other slot can contradict it', async () => {
      await expect(chain.readState(ChainId.MATIC_MAINNET, MANAGER, [DIGEST_SLOT, SIGNATURE_SLOT])).resolves.toEqual({
        uses: 0,
        cancelled: true
      })
    })
  })

  describe('and no slot holds anything', () => {
    beforeEach(() => {
      signatureUses.mockResolvedValue(0n)
      cancelledSignatures.mockResolvedValue(false)
    })

    it('should report an unused coupon', async () => {
      await expect(chain.readState(ChainId.MATIC_MAINNET, MANAGER, [DIGEST_SLOT, SIGNATURE_SLOT])).resolves.toEqual({
        uses: 0,
        cancelled: false
      })
    })
  })
})
