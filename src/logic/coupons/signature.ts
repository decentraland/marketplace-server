/* eslint-disable @typescript-eslint/naming-convention */
import { AbiCoder, TypedDataDomain, TypedDataEncoder, TypedDataField, keccak256, toBeArray, verifyTypedData, zeroPadValue } from 'ethers'
import { ChainId, TradeChecks } from '@dcl/schemas'
import { ContractName, getContract, getCouponManager } from 'decentraland-transactions'
import { fromMillisecondsToSeconds } from '../date'
import { MARKETPLACE_TRADE_TYPES, OFF_CHAIN_MARKETPLACE_CONTRACT_NAMES } from '../trades/utils'

/**
 * Rate discount, in parts per million: 300_000 is 30% off. The only discount type the Shop signs. A flat
 * discount applies its amount to every received asset and reverts when it exceeds an item's price, which
 * is a footgun no product needs yet.
 */
export const DISCOUNT_TYPE_RATE = 1

export type CouponContracts = {
  /** The off-chain marketplace version the manager is wired into: the only one that redeems coupons signed against it. */
  marketplace: ContractName
  couponManager: { address: string; name: string; version: string }
  collectionDiscountCoupon: string
}

/**
 * The coupon deployments of a chain, one per off-chain marketplace version, newest first.
 *
 * Each marketplace version trusts its own CouponManager, so while two versions are live a chain has two
 * managers and a coupon belongs to whichever one it was signed against. The CollectionDiscountCoupon is
 * one per chain, shared by every manager. Empty on a chain without collections, where nothing is deployed.
 */
export function getCouponContracts(chainId: ChainId): CouponContracts[] {
  let collectionDiscountCoupon: string
  try {
    collectionDiscountCoupon = getContract(ContractName.CollectionDiscountCoupon, chainId).address
  } catch (error) {
    return []
  }
  return OFF_CHAIN_MARKETPLACE_CONTRACT_NAMES.reduce<CouponContracts[]>((contracts, marketplace) => {
    try {
      const manager = getCouponManager(marketplace, chainId)
      contracts.push({
        marketplace,
        couponManager: { address: manager.address, name: manager.name, version: manager.version },
        collectionDiscountCoupon
      })
    } catch (error) {
      // A version without a manager on this chain is simply not a candidate.
    }
    return contracts
  }, [])
}

// keccak256("Coupon(Checks checks,address couponAddress,bytes data)Checks(...)ExternalCheck(...)"), with the
// same Checks and ExternalCheck the marketplace signs, so the two type sets cannot drift.
export const COUPON_TYPES: Record<string, TypedDataField[]> = {
  Coupon: [
    { name: 'checks', type: 'Checks' },
    { name: 'couponAddress', type: 'address' },
    { name: 'data', type: 'bytes' }
  ],
  Checks: MARKETPLACE_TRADE_TYPES.Checks,
  ExternalCheck: MARKETPLACE_TRADE_TYPES.ExternalCheck
}

/** `abi.encode(CollectionDiscountCouponData)`: the bytes the creator signs and the contract decodes. */
export function encodeCouponData(discountType: number, discountPpm: number, root: string): string {
  return AbiCoder.defaultAbiCoder().encode(['uint256', 'uint256', 'bytes32'], [discountType, discountPpm, root])
}

export function getCouponManagerDomain(chainId: ChainId, contracts: CouponContracts): TypedDataDomain {
  return {
    name: contracts.couponManager.name,
    version: contracts.couponManager.version,
    salt: zeroPadValue(toBeArray(chainId), 32),
    verifyingContract: contracts.couponManager.address
  }
}

/** The EIP-712 values for a coupon. `checks` timestamps arrive in milliseconds, like a trade's, and are signed in seconds. */
export function getCouponTypedValues(checks: TradeChecks, couponAddress: string, data: string): Record<string, unknown> {
  return {
    checks: {
      uses: checks.uses,
      expiration: fromMillisecondsToSeconds(checks.expiration),
      effective: fromMillisecondsToSeconds(checks.effective),
      salt: zeroPadValue(checks.salt, 32),
      contractSignatureIndex: checks.contractSignatureIndex,
      signerSignatureIndex: checks.signerSignatureIndex,
      allowedRoot: zeroPadValue(checks.allowedRoot, 32),
      externalChecks: (checks.externalChecks ?? []).map(externalCheck => ({
        contractAddress: externalCheck.contractAddress,
        selector: externalCheck.selector,
        value: externalCheck.value ? externalCheck.value : '0x',
        required: externalCheck.required
      }))
    },
    couponAddress,
    data
  }
}

/** Whether `signature` is `signer`'s EIP-712 signature of this coupon against one CouponManager. */
export function verifyCouponSignature(
  chainId: ChainId,
  contracts: CouponContracts,
  checks: TradeChecks,
  couponAddress: string,
  data: string,
  signature: string,
  signer: string
): boolean {
  const domain = getCouponManagerDomain(chainId, contracts)
  const values = getCouponTypedValues(checks, couponAddress, data)
  let recovered: string
  try {
    recovered = verifyTypedData(domain, COUPON_TYPES, values, signature)
  } catch (error) {
    // A structurally invalid signature (r off the curve, a high s) throws instead of recovering a stranger.
    return false
  }
  return recovered.toLowerCase() === signer.toLowerCase()
}

/**
 * Which of the chain's coupon deployments `signature` was made against, or null if none. The EIP-712
 * domain names its verifying contract, so a coupon signed against one manager verifies against that one
 * alone, and the match says which marketplace can redeem it.
 */
export function resolveCouponSignature(
  chainId: ChainId,
  candidates: CouponContracts[],
  checks: TradeChecks,
  couponAddress: string,
  data: string,
  signature: string,
  signer: string
): CouponContracts | null {
  return candidates.find(contracts => verifyCouponSignature(chainId, contracts, checks, couponAddress, data, signature, signer)) ?? null
}

/** The coupon deployment of `chainId` whose manager is `address`, or null when the library no longer lists it. */
export function findCouponContracts(chainId: ChainId, address: string): CouponContracts | null {
  const wanted = address.toLowerCase()
  return getCouponContracts(chainId).find(contracts => contracts.couponManager.address.toLowerCase() === wanted) ?? null
}

/** The EIP-712 digest of a coupon: what the creator's wallet actually hashed before signing. */
export function couponDigest(
  chainId: ChainId,
  contracts: CouponContracts,
  checks: TradeChecks,
  couponAddress: string,
  data: string
): string {
  const domain = getCouponManagerDomain(chainId, contracts)
  const values = getCouponTypedValues(checks, couponAddress, data)
  return TypedDataEncoder.hash(domain, COUPON_TYPES, values)
}

/**
 * The two slots a CouponManager can record a coupon's uses and cancellation under, one per generation of
 * the contract. Both are live, because a coupon belongs to whichever manager it was signed against.
 *
 * The managers paired with the newest marketplace key on the EIP-712 digest, so that a re-encoded
 * signature cannot present itself as a fresh coupon. The earlier ones key on the signature bytes. Which
 * is which is not worth a table here: a coupon is bound to a single manager, so at most one of these
 * slots can ever hold anything, and reading both always answers.
 */
export function digestCouponStateKey(signer: string, digest: string): string {
  return couponStateKey(signer, digest)
}

/** @see digestCouponStateKey */
export function legacyCouponStateKey(signer: string, signature: string): string {
  return couponStateKey(signer, keccak256(signature))
}

function couponStateKey(signer: string, handle: string): string {
  return keccak256(AbiCoder.defaultAbiCoder().encode(['address', 'bytes32'], [signer, handle]))
}
