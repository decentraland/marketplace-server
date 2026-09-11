import { ChainId, Network, TradeChecks } from '@dcl/schemas'

/** Percentage bounds a creator may sign, in parts per million: 5% to 70%. */
export const MIN_DISCOUNT_PPM = 50_000
export const MAX_DISCOUNT_PPM = 700_000
/** The longest a sale may run. A permanent discount is a price, not a sale, and it would make the list price a fake reference. */
export const MAX_COUPON_DURATION_MS = 30 * 24 * 60 * 60 * 1000
export const MAX_COUPON_COLLECTIONS = 50
/**
 * The furthest ahead a sale may be scheduled. Without a bound, `effective` only had to sit within a
 * 30-day window of `expiration`, so a date far enough out overflowed the Date the insert builds, and a
 * sale parked years away would be polled by the refresh job forever without ever being buyable.
 */
export const MAX_COUPON_SCHEDULE_AHEAD_MS = 30 * 24 * 60 * 60 * 1000
/** How often the on-chain uses/cancellation of live coupons are re-read. */
export const COUPON_STATE_REFRESH_INTERVAL_MS = 60 * 1000

/**
 * What the Shop posts after the creator signs: the coupon fields the CouponManager hashes, plus the
 * collection list the Merkle root was built from so the server can rebuild the root and the proofs.
 * `checks` timestamps are in MILLISECONDS, like a trade's, and were signed in seconds.
 */
export type CouponCreation = {
  signer: string
  chainId: ChainId
  network: Network
  checks: TradeChecks
  couponAddress: string
  discountType: number
  discount: number
  collections: string[]
  signature: string
}

export type DBCoupon = {
  id: string
  network: string
  chain_id: number
  signer: string
  signature: string
  hashed_signature: string
  state_key: string
  coupon_manager: string
  coupon_address: string
  checks: TradeChecks
  discount_type: number
  discount_ppm: number
  root: string
  collections: string[]
  effective_since: Date
  expires_at: Date
  created_at: Date
}

export type DBCouponWithState = DBCoupon & {
  state_uses: number | null
  state_cancelled: boolean | null
  state_revoked: boolean | null
  state_checked_at: Date | null
}

/**
 * `revoked` covers the signature indexes moving past the ones the coupon was signed with. A creator who
 * wants every sale to stop calls `increaseSignerSignatureIndex()` — one argumentless call, against
 * rebuilding each coupon's calldata for `cancelSignature` — and the contract then refuses all of them.
 */
export type CouponStatus = 'scheduled' | 'active' | 'ended' | 'cancelled' | 'exhausted' | 'revoked'

export type Coupon = {
  id: string
  signer: string
  chainId: number
  network: string
  checks: TradeChecks
  couponManager: string
  couponAddress: string
  discountType: number
  discount: number
  root: string
  collections: string[]
  signature: string
  createdAt: number
  /** Consumed uses, cancellation and index revocation as last read from the CouponManager; null before the first read. */
  state: { uses: number; cancelled: boolean; revoked: boolean; checkedAt: number } | null
  status: CouponStatus
}

export type CouponChainIndexes = { contractSignatureIndex: number; signerSignatureIndex: number }
/** What the CouponManager reports for one signature. */
export type CouponChainState = { uses: number; cancelled: boolean }
/** What gets persisted: the manager's own state plus whether the signature indexes have moved past it. */
export type CouponStoredState = CouponChainState & { revoked: boolean }

/** The two things the server asks the CouponManager on-chain: the signature indexes at signing time, and a coupon's live state. */
export type ICouponChainReader = {
  readIndexes(chainId: ChainId, couponManager: string, signer: string): Promise<CouponChainIndexes>
  readState(chainId: ChainId, couponManager: string, stateKey: string): Promise<CouponChainState>
}

export type ICouponsComponent = {
  addCoupon(body: CouponCreation, signer: string): Promise<Coupon>
  getCouponsBySigner(signer: string): Promise<Coupon[]>
  getCoupon(id: string): Promise<Coupon>
  /** Re-reads the on-chain state of every live or upcoming coupon. Returns how many were refreshed. */
  refreshState(): Promise<number>
}
