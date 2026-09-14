import { Signature } from 'ethers'
import { ChainId, Network } from '@dcl/schemas'
import { getNetworkChainId } from '../../logic/chainIds'
import { collectionsRoot, uniqueCollections } from '../../logic/coupons/merkle'
import {
  couponStateKey,
  DISCOUNT_TYPE_RATE,
  encodeCouponData,
  getCouponContracts,
  verifyCouponSignature
} from '../../logic/coupons/signature'
import { isErrorWithMessage } from '../../logic/errors'
import { hasECDSASignatureAValidV } from '../../logic/signatures'
import { AppComponents } from '../../types'
import { createCouponChainReader } from './chain'
import {
  CouponAlreadyUnusableError,
  CouponNotFoundError,
  DuplicateCouponError,
  InvalidCouponAddressError,
  InvalidCouponChecksError,
  InvalidCouponCollectionsError,
  InvalidCouponDiscountError,
  InvalidCouponSignatureError,
  InvalidCouponSignatureIndexError,
  InvalidCouponNetworkError,
  InvalidCouponSignerError,
  NotCollectionCreatorError,
  UnsupportedCouponChainError
} from './errors'
import {
  getCollectionCreatorsQuery,
  getCouponByIdQuery,
  getCouponsBySignerQuery,
  getCouponsToRefreshQuery,
  getInsertCouponQuery,
  getUpsertCouponStateQuery
} from './queries'
import {
  Coupon,
  CouponCreation,
  CouponStatus,
  DBCoupon,
  DBCouponWithState,
  CouponChainIndexes,
  CouponPagination,
  CouponStoredState,
  ICouponChainReader,
  ICouponsComponent,
  MAX_COUPON_COLLECTIONS,
  MAX_COUPON_DURATION_MS,
  MAX_COUPON_SCHEDULE_AHEAD_MS,
  MAX_DISCOUNT_PPM,
  MIN_DISCOUNT_PPM
} from './types'

const ZERO_BYTES32 = '0x' + '00'.repeat(32)
const REFRESH_BATCH = 200
/** How many coupons of a batch are read from chain at once — enough to keep a tick short of its interval,
 * small enough not to hand the RPC the whole batch in one burst. */
const REFRESH_CONCURRENCY = 10
/** Page size when a caller does not ask for one — a creator's sales list, newest first. */
const DEFAULT_PAGE_LIMIT = 100
const PG_UNIQUE_VIOLATION = '23505'

/** Postgres reports the code in every locale; the message text does not. */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === PG_UNIQUE_VIOLATION
}

/**
 * Creator-signed discount coupons for the Shop.
 *
 * A coupon is validated the way a trade is: the caller must be its signer, the EIP-712 signature must
 * verify against the chain's CouponManager, and everything the contract will check at purchase time
 * (creator, indexes, window) is checked here first so a coupon that can never settle is never shown.
 */
export function createCouponsComponent(
  components: Pick<AppComponents, 'dappsDatabase' | 'logs'>,
  options: { chain?: ICouponChainReader } = {}
): ICouponsComponent {
  const { dappsDatabase: pg, logs } = components
  const logger = logs.getLogger('Coupons component')
  const chain = options.chain ?? createCouponChainReader()

  function toCoupon(row: DBCouponWithState, now = Date.now()): Coupon {
    const state =
      row.state_checked_at !== null && row.state_uses !== null && row.state_cancelled !== null
        ? {
            uses: Number(row.state_uses),
            cancelled: row.state_cancelled,
            revoked: row.state_revoked ?? false,
            checkedAt: new Date(row.state_checked_at).getTime()
          }
        : null
    const effectiveSince = new Date(row.effective_since).getTime()
    const expiresAt = new Date(row.expires_at).getTime()
    let status: CouponStatus = 'active'
    if (state?.cancelled) status = 'cancelled'
    else if (state?.revoked) status = 'revoked'
    else if (state && state.uses >= Number(row.checks.uses)) status = 'exhausted'
    else if (expiresAt <= now) status = 'ended'
    else if (effectiveSince > now) status = 'scheduled'

    return {
      id: row.id,
      signer: row.signer,
      chainId: row.chain_id,
      network: row.network,
      checks: row.checks,
      couponManager: row.coupon_manager,
      couponAddress: row.coupon_address,
      discountType: row.discount_type,
      discount: row.discount_ppm,
      root: row.root,
      collections: row.collections,
      signature: row.signature,
      createdAt: new Date(row.created_at).getTime(),
      state,
      status
    }
  }

  function normalizeCollections(collections: string[]): string[] {
    const unique = uniqueCollections(collections)
    if (unique.length === 0) {
      throw new InvalidCouponCollectionsError('A coupon must cover at least one collection')
    }
    if (unique.length > MAX_COUPON_COLLECTIONS) {
      throw new InvalidCouponCollectionsError(`A coupon may cover at most ${MAX_COUPON_COLLECTIONS} collections`)
    }
    return unique
  }

  function validateChecks(coupon: CouponCreation, now: number): void {
    const { checks } = coupon
    if (!Number.isInteger(checks.uses) || checks.uses < 1) {
      throw new InvalidCouponChecksError('A coupon must allow at least one use')
    }
    if (checks.expiration <= now) {
      throw new InvalidCouponChecksError('Coupon expiration date must be in the future')
    }
    if (checks.effective > checks.expiration) {
      throw new InvalidCouponChecksError('Coupon should be effective before it expires')
    }
    if (checks.effective > now + MAX_COUPON_SCHEDULE_AHEAD_MS) {
      throw new InvalidCouponChecksError('A sale may not be scheduled more than 30 days ahead')
    }
    if (checks.expiration - Math.max(checks.effective, now) > MAX_COUPON_DURATION_MS) {
      throw new InvalidCouponChecksError('A sale may run for at most 30 days')
    }
    // The Shop applies a coupon for whoever is buying, so a coupon restricted to an allow-list or to
    // external checks would fail at checkout for everyone it is shown to.
    if (checks.allowedRoot && checks.allowedRoot !== '0x' && checks.allowedRoot !== ZERO_BYTES32) {
      throw new InvalidCouponChecksError('A coupon cannot restrict who may use it')
    }
    if (checks.externalChecks && checks.externalChecks.length > 0) {
      throw new InvalidCouponChecksError('A coupon cannot carry external checks')
    }
  }

  async function validateCreator(signer: string, collections: string[], chainId: ChainId): Promise<void> {
    const result = await pg.query<{ id: string; creator: string | null }>(getCollectionCreatorsQuery(collections, chainId))
    const creators = new Map(result.rows.map(row => [row.id.toLowerCase(), row.creator?.toLowerCase() ?? null]))
    for (const collection of collections) {
      if (creators.get(collection) !== signer.toLowerCase()) {
        throw new NotCollectionCreatorError(collection)
      }
    }
  }

  async function addCoupon(coupon: CouponCreation, signer: string): Promise<Coupon> {
    const now = Date.now()

    if (coupon.signer.toLowerCase() !== signer.toLowerCase()) {
      throw new InvalidCouponSignerError()
    }

    const contracts = getCouponContracts(coupon.chainId)
    if (!contracts) {
      throw new UnsupportedCouponChainError(coupon.chainId)
    }
    if (coupon.couponAddress.toLowerCase() !== contracts.collectionDiscountCoupon.toLowerCase()) {
      throw new InvalidCouponAddressError()
    }

    // The domain salt binds the signature to `chainId`; `network` is only a label, so a mismatched one
    // would make every later query that filters coupons by network miss or mis-attribute this row.
    const isKnownNetwork = coupon.network === Network.ETHEREUM || coupon.network === Network.MATIC
    if (!isKnownNetwork || getNetworkChainId(coupon.network) !== coupon.chainId) {
      throw new InvalidCouponNetworkError()
    }

    if (coupon.discountType !== DISCOUNT_TYPE_RATE) {
      throw new InvalidCouponDiscountError('Only percentage discounts are supported')
    }
    if (!Number.isInteger(coupon.discount) || coupon.discount < MIN_DISCOUNT_PPM || coupon.discount > MAX_DISCOUNT_PPM) {
      throw new InvalidCouponDiscountError('The discount must be between 5% and 70%')
    }

    const collections = normalizeCollections(coupon.collections)
    validateChecks(coupon, now)

    if (coupon.signature.length !== 132 || !hasECDSASignatureAValidV(coupon.signature)) {
      throw new InvalidCouponSignatureError()
    }

    /**
     * ECDSA lets the same signature be re-encoded with a flipped `s` and `v`. Both recover the same signer,
     * but they hash differently — so `hashed_signature` and the `state_key` derived from it would see two
     * coupons where there is one, each tracking its own on-chain state behind a unique constraint that
     * cannot tell them apart.
     *
     * `Signature.from` refuses the non-canonical form rather than folding it, which is the behaviour we
     * want here: wallets and libraries only ever produce the canonical one, so the other form arrives only
     * when someone has gone out of their way to build it.
     */
    let signature: string
    try {
      signature = Signature.from(coupon.signature).serialized
    } catch {
      throw new InvalidCouponSignatureError()
    }

    const root = collectionsRoot(collections)
    const data = encodeCouponData(coupon.discountType, coupon.discount, root)
    if (!verifyCouponSignature(coupon.chainId, contracts, coupon.checks, coupon.couponAddress, data, signature, signer)) {
      throw new InvalidCouponSignatureError()
    }

    await validateCreator(signer, collections, coupon.chainId)

    // The contract rejects a coupon whose indexes lag the manager's, so a stale one is refused now rather
    // than shown to buyers and failing at checkout.
    const indexes = await chain.readIndexes(coupon.chainId, contracts.couponManager.address, signer)
    if (
      indexes.contractSignatureIndex !== coupon.checks.contractSignatureIndex ||
      indexes.signerSignatureIndex !== coupon.checks.signerSignatureIndex
    ) {
      throw new InvalidCouponSignatureIndexError()
    }

    const stateKey = couponStateKey(signer, signature)
    const chainState = await chain.readState(coupon.chainId, contracts.couponManager.address, stateKey)
    if (chainState.cancelled) {
      throw new CouponAlreadyUnusableError('This coupon was already cancelled on chain')
    }
    if (chainState.uses >= coupon.checks.uses) {
      throw new CouponAlreadyUnusableError('This coupon has no uses left')
    }
    // The indexes were just checked against the manager, so nothing is revoked yet.
    const state: CouponStoredState = { ...chainState, revoked: false }

    const inserted = await pg.withTransaction(
      async client => {
        const result = await client.query<DBCoupon>(
          getInsertCouponQuery({
            ...coupon,
            signature,
            collections,
            root,
            stateKey,
            couponManager: contracts.couponManager.address
          })
        )
        const row = result.rows[0]
        await client.query(getUpsertCouponStateQuery(row.id, state))
        return row
      },
      e => {
        if (isUniqueViolation(e)) {
          throw new DuplicateCouponError()
        }
        throw new Error(isErrorWithMessage(e) ? e.message : 'Could not create coupon')
      }
    )

    logger.info(`Coupon ${inserted.id} created by ${signer} for ${collections.length} collection(s) at ${coupon.discount / 10_000}% off`)

    return toCoupon(
      {
        ...inserted,
        state_uses: state.uses,
        state_cancelled: state.cancelled,
        state_revoked: state.revoked,
        state_checked_at: new Date(now)
      },
      now
    )
  }

  async function getCouponsBySigner(signer: string, pagination: CouponPagination = {}): Promise<Coupon[]> {
    const { limit = DEFAULT_PAGE_LIMIT, offset = 0 } = pagination
    const result = await pg.query<DBCouponWithState>(getCouponsBySignerQuery(signer, limit, offset))
    const now = Date.now()
    return result.rows.map(row => toCoupon(row, now))
  }

  async function getCoupon(id: string): Promise<Coupon> {
    const result = await pg.query<DBCouponWithState>(getCouponByIdQuery(id))
    if (!result.rowCount) {
      throw new CouponNotFoundError(id)
    }
    return toCoupon(result.rows[0])
  }

  async function refreshState(): Promise<number> {
    const result = await pg.query<DBCouponWithState>(getCouponsToRefreshQuery(REFRESH_BATCH))
    // Every coupon of one creator shares a signer, so the indexes cost roughly one read per creator per
    // tick rather than one per coupon. The READ is what is cached, not its result: coupons of the same
    // signer are refreshed side by side, and caching the value alone let every one of them miss the map
    // and fire its own request before the first had answered.
    const indexesBySigner = new Map<string, Promise<CouponChainIndexes>>()
    let refreshed = 0

    function readIndexesOnce(row: DBCouponWithState): Promise<CouponChainIndexes> {
      const indexKey = `${row.chain_id}:${row.coupon_manager}:${row.signer}`
      let pending = indexesBySigner.get(indexKey)
      if (!pending) {
        pending = chain.readIndexes(row.chain_id as ChainId, row.coupon_manager, row.signer).catch(e => {
          // Drop the failed read so the next chunk can try again, instead of every later coupon of this
          // signer inheriting one unlucky timeout for the rest of the tick.
          indexesBySigner.delete(indexKey)
          throw e
        })
        indexesBySigner.set(indexKey, pending)
      }
      return pending
    }

    async function refreshOne(row: DBCouponWithState): Promise<void> {
      const chainState = await chain.readState(row.chain_id as ChainId, row.coupon_manager, row.state_key)
      const indexes = await readIndexesOnce(row)
      // `cancelSignature` takes a coupon's whole calldata, so a creator ending every sale at once reaches
      // for `increaseSignerSignatureIndex()` instead. That leaves `cancelled` false while the contract
      // refuses the coupon, which is why the indexes have to be re-read and not just checked at signing.
      const revoked =
        indexes.contractSignatureIndex !== row.checks.contractSignatureIndex ||
        indexes.signerSignatureIndex !== row.checks.signerSignatureIndex
      await pg.query(getUpsertCouponStateQuery(row.id, { ...chainState, revoked }))
    }

    // In chunks, not one at a time: a full batch is up to REFRESH_BATCH coupons and each costs an RPC round
    // trip, so sequentially a tick could outlast the interval that schedules it and the catalogue would
    // serve state older than it claims. Chunked rather than all at once so a big batch doesn't arrive at the
    // RPC as one burst.
    for (let i = 0; i < result.rows.length; i += REFRESH_CONCURRENCY) {
      const chunk = result.rows.slice(i, i + REFRESH_CONCURRENCY)
      const settled = await Promise.allSettled(chunk.map(row => refreshOne(row)))
      settled.forEach((outcome, index) => {
        if (outcome.status === 'fulfilled') {
          refreshed++
          return
        }
        // One unreachable RPC read must not stop the rest of the batch; the row keeps its last known state
        // and is first in line next tick.
        const e = outcome.reason
        logger.warn(`Could not refresh the state of coupon ${chunk[index].id}: ${isErrorWithMessage(e) ? e.message : String(e)}`)
      })
    }
    // A per-tick line, not just the per-coupon warnings: failures are settled rather than thrown, so the
    // job's own error handler never fires and a batch quietly failing half its reads would otherwise look
    // exactly like a batch succeeding.
    logger.info(`Refreshed the on-chain state of ${refreshed}/${result.rows.length} coupon(s)`)
    return refreshed
  }

  return { addCoupon, getCouponsBySigner, getCoupon, refreshState }
}
