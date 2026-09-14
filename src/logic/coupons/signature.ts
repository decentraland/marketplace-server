/* eslint-disable @typescript-eslint/naming-convention */
import { AbiCoder, TypedDataDomain, TypedDataField, keccak256, toBeArray, verifyTypedData, zeroPadValue } from 'ethers'
import { ChainId, TradeChecks } from '@dcl/schemas'
import { ContractName, getContract } from 'decentraland-transactions'
import { fromMillisecondsToSeconds } from '../date'
import { MARKETPLACE_TRADE_TYPES } from '../trades/utils'

/**
 * Rate discount, in parts per million: 300_000 is 30% off. The only discount type the Shop signs. A flat
 * discount applies its amount to every received asset and reverts when it exceeds an item's price, which
 * is a footgun no product needs yet.
 */
export const DISCOUNT_TYPE_RATE = 1

export type CouponContracts = {
  couponManager: { address: string; name: string; version: string }
  collectionDiscountCoupon: string
}

/**
 * The coupon deployments, from the transactions library when the installed version knows the chain.
 *
 * Polygon mainnet is listed in the public registry (contracts.decentraland.org/addresses.json) and wired
 * on-chain, but the library version this server pins predates its entry, so it is spelled out here as a
 * fallback. Remove once the library bump lands.
 */
const REGISTRY_FALLBACK: Partial<Record<number, CouponContracts>> = {
  [ChainId.MATIC_MAINNET]: {
    couponManager: { address: '0x3fd3056ee72a2a85e9392fab3a450e7736536081', name: 'CouponManager', version: '1.0.0' },
    collectionDiscountCoupon: '0xc914507fe297b2dddd1232ac3a8903f1c125e794'
  }
}

export function getCouponContracts(chainId: ChainId): CouponContracts | null {
  try {
    const manager = getContract(ContractName.CouponManager, chainId)
    const coupon = getContract(ContractName.CollectionDiscountCoupon, chainId)
    return {
      couponManager: { address: manager.address, name: manager.name, version: manager.version },
      collectionDiscountCoupon: coupon.address
    }
  } catch (error) {
    return REGISTRY_FALLBACK[chainId] ?? null
  }
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

/** Whether `signature` is `signer`'s EIP-712 signature of this coupon against the chain's CouponManager. */
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
 * The slot the CouponManager keys `signatureUses` and `cancelledSignatures` on:
 * keccak256(abi.encode(signer, keccak256(signature))). Not keccak256(signature) alone — that reads zero
 * forever on the deployed contracts.
 */
export function couponStateKey(signer: string, signature: string): string {
  return keccak256(AbiCoder.defaultAbiCoder().encode(['address', 'bytes32'], [signer, keccak256(signature)]))
}
