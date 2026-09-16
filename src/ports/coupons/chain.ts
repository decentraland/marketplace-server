import { Contract, JsonRpcProvider } from 'ethers'
import { ChainId } from '@dcl/schemas'
import { getRPCUrlByChainId } from '../../logic/trades/utils'
import { CouponChainIndexes, CouponChainState, ICouponChainReader } from './types'

const COUPON_MANAGER_ABI = [
  'function allowedCoupons(address) view returns (bool)',
  'function contractSignatureIndex() view returns (uint256)',
  'function signerSignatureIndex(address) view returns (uint256)',
  'function signatureUses(bytes32) view returns (uint256)',
  'function cancelledSignatures(bytes32) view returns (bool)'
]

/** Reads the CouponManager over the chain's public RPC. One provider per chain, created on first use. */
export function createCouponChainReader(): ICouponChainReader {
  const providers = new Map<ChainId, JsonRpcProvider>()

  function couponManager(chainId: ChainId, address: string): Contract {
    let provider = providers.get(chainId)
    if (!provider) {
      provider = new JsonRpcProvider(getRPCUrlByChainId(chainId))
      providers.set(chainId, provider)
    }
    return new Contract(address, COUPON_MANAGER_ABI, provider)
  }

  async function readCouponAllowed(chainId: ChainId, managerAddress: string, coupon: string): Promise<boolean> {
    return Boolean(await couponManager(chainId, managerAddress).allowedCoupons(coupon))
  }

  /**
   * The manager returns uint256, and these are narrowed to `number` to be compared against the numbers the
   * coupon was signed with. Safe for what they are — monotonic counters bumped one at a time by a wallet,
   * which would need 2^53 cancellations to reach the precision limit — and the same narrowing the trades
   * module does with its own indexes. A value that big would mean something else has already gone wrong.
   */
  async function readIndexes(chainId: ChainId, managerAddress: string, signer: string): Promise<CouponChainIndexes> {
    const manager = couponManager(chainId, managerAddress)
    const [contractSignatureIndex, signerSignatureIndex] = await Promise.all([
      manager.contractSignatureIndex(),
      manager.signerSignatureIndex(signer)
    ])
    return { contractSignatureIndex: Number(contractSignatureIndex), signerSignatureIndex: Number(signerSignatureIndex) }
  }

  async function readState(chainId: ChainId, managerAddress: string, stateKey: string): Promise<CouponChainState> {
    const manager = couponManager(chainId, managerAddress)
    const [uses, cancelled] = await Promise.all([manager.signatureUses(stateKey), manager.cancelledSignatures(stateKey)])
    return { uses: Number(uses), cancelled: Boolean(cancelled) }
  }

  return { readCouponAllowed, readIndexes, readState }
}
