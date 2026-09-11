import { keccak256 } from 'ethers'
import SQL, { SQLStatement } from 'sql-template-strings'
import { MARKETPLACE_SQUID_SCHEMA } from '../../constants'
import { CouponCreation, CouponStoredState } from './types'

export type CouponInsert = CouponCreation & {
  couponManager: string
  root: string
  stateKey: string
  /** Lower-cased, de-duplicated. */
  collections: string[]
}

export function getInsertCouponQuery(coupon: CouponInsert): SQLStatement {
  return SQL`INSERT INTO marketplace.coupons (
    network,
    chain_id,
    signer,
    signature,
    hashed_signature,
    state_key,
    coupon_manager,
    coupon_address,
    checks,
    discount_type,
    discount_ppm,
    root,
    collections,
    effective_since,
    expires_at
  ) VALUES (
    ${coupon.network},
    ${coupon.chainId},
    ${coupon.signer.toLowerCase()},
    ${coupon.signature},
    ${keccak256(coupon.signature)},
    ${coupon.stateKey},
    ${coupon.couponManager.toLowerCase()},
    ${coupon.couponAddress.toLowerCase()},
    ${coupon.checks},
    ${coupon.discountType},
    ${coupon.discount},
    ${coupon.root},
    ${coupon.collections},
    ${new Date(coupon.checks.effective)},
    ${new Date(coupon.checks.expiration)}
  ) RETURNING *;`
}

const SELECT_WITH_STATE = SQL`SELECT
    c.*,
    cs.uses AS state_uses,
    cs.cancelled AS state_cancelled,
    cs.revoked AS state_revoked,
    cs.checked_at AS state_checked_at
  FROM marketplace.coupons c
  LEFT JOIN marketplace.coupon_state cs ON cs.coupon_id = c.id`

export function getCouponsBySignerQuery(signer: string): SQLStatement {
  return SQL``.append(SELECT_WITH_STATE).append(SQL` WHERE c.signer = ${signer.toLowerCase()} ORDER BY c.created_at DESC`)
}

export function getCouponByIdQuery(id: string): SQLStatement {
  return SQL``.append(SELECT_WITH_STATE).append(SQL` WHERE c.id = ${id}`)
}

/**
 * The coupons whose on-chain state is worth re-reading: live ones, and ones starting within a day so the
 * first read lands before the first buyer. Least recently checked first, bounded so one tick stays cheap.
 */
export function getCouponsToRefreshQuery(limit: number): SQLStatement {
  return SQL``.append(SELECT_WITH_STATE).append(SQL`
    WHERE c.expires_at > now()
      AND c.effective_since <= now() + interval '1 day'
    ORDER BY cs.checked_at ASC NULLS FIRST
    LIMIT ${limit}`)
}

export function getUpsertCouponStateQuery(couponId: string, state: CouponStoredState): SQLStatement {
  return SQL`INSERT INTO marketplace.coupon_state (coupon_id, uses, cancelled, revoked, checked_at)
    VALUES (${couponId}, ${state.uses}, ${state.cancelled}, ${state.revoked}, now())
    ON CONFLICT (coupon_id) DO UPDATE SET
      uses = EXCLUDED.uses,
      cancelled = EXCLUDED.cancelled,
      revoked = EXCLUDED.revoked,
      checked_at = now()`
}

/**
 * Who created each collection on the coupon's own chain, from the squid. Missing rows mean the collection
 * is unknown to the indexer there. Scoped by `chain_id` because the table holds every network the squid
 * follows: the same address on another chain is a different contract, and the coupon would be accepted
 * here only to revert at checkout when `ICollection(collection).creator()` disagrees.
 */
export function getCollectionCreatorsQuery(collections: string[], chainId: number): SQLStatement {
  return SQL`SELECT id, creator FROM `
    .append(MARKETPLACE_SQUID_SCHEMA)
    .append(SQL`.collection WHERE id = ANY(${collections}) AND chain_id = ${chainId}`)
}
