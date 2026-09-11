import { Contract, JsonRpcProvider } from 'ethers'
import { ChainId } from '@dcl/schemas'
import { getRPCUrlByChainId } from '../../logic/trades/utils'
import { CouponChainIndexes, CouponChainState, ICouponChainReader } from './types'

const COUPON_MANAGER_ABI = [
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

  return { readIndexes, readState }
}
