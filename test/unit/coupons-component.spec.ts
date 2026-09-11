import { Wallet } from 'ethers'
import { ChainId, Network, TradeChecks } from '@dcl/schemas'
import { collectionsRoot } from '../../src/logic/coupons/merkle'
import {
  COUPON_TYPES,
  CouponContracts,
  DISCOUNT_TYPE_RATE,
  encodeCouponData,
  getCouponContracts,
  getCouponManagerDomain,
  getCouponTypedValues
} from '../../src/logic/coupons/signature'
import { createCouponsComponent } from '../../src/ports/coupons/component'
import {
  CouponAlreadyUnusableError,
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
} from '../../src/ports/coupons/errors'
import { CouponCreation, DBCoupon, ICouponChainReader, ICouponsComponent } from '../../src/ports/coupons/types'
import { IPgComponent } from '../../src/ports/db/types'
import { createTestLogsComponent, createTestPgComponent } from '../components'

const CHAIN_ID = ChainId.MATIC_MAINNET

/** Non-null by construction, so every case below reads as coupon logic rather than as null handling. */
function requireCouponContracts(): CouponContracts {
  const contracts = getCouponContracts(CHAIN_ID)
  if (!contracts) {
    throw new Error('Polygon mainnet must resolve a coupon pair for these tests to mean anything')
  }
  return contracts
}

const CONTRACTS = requireCouponContracts()

const COLLECTION = '0x4c09495cd2d4e3d3fa2808eb655d013de426157b'
const DAY = 24 * 60 * 60 * 1000

let creator: Wallet
let pg: IPgComponent
let chain: ICouponChainReader
let readIndexesMock: jest.Mock
let readStateMock: jest.Mock
let dbQueryMock: jest.Mock
let dbClientQueryMock: jest.Mock
let coupons: ICouponsComponent

function buildChecks(overrides: Partial<TradeChecks> = {}): TradeChecks {
  const now = Date.now()
  return {
    uses: 10,
    effective: now - 1000,
    expiration: now + 7 * DAY,
    salt: '0x' + '11'.repeat(32),
    contractSignatureIndex: 0,
    signerSignatureIndex: 0,
    allowedRoot: '0x' + '00'.repeat(32),
    externalChecks: [],
    ...overrides
  } as TradeChecks
}

/** A coupon signed for real, so only the field under test is ever what makes a case fail. */
async function buildCoupon(overrides: Partial<CouponCreation> = {}): Promise<CouponCreation> {
  const base: Omit<CouponCreation, 'signature'> = {
    signer: creator.address,
    chainId: CHAIN_ID,
    network: Network.MATIC,
    checks: buildChecks(),
    couponAddress: CONTRACTS.collectionDiscountCoupon,
    discountType: DISCOUNT_TYPE_RATE,
    discount: 300_000,
    collections: [COLLECTION],
    ...overrides
  }
  const data = encodeCouponData(base.discountType, base.discount, collectionsRoot(base.collections))
  const signature = await creator.signTypedData(
    getCouponManagerDomain(CHAIN_ID, CONTRACTS),
    COUPON_TYPES,
    getCouponTypedValues(base.checks, base.couponAddress, data)
  )
  return { ...base, signature, ...(overrides.signature ? { signature: overrides.signature } : {}) }
}

function buildRow(coupon: CouponCreation): DBCoupon {
  return {
    id: 'b9c0d1e2-0000-4000-8000-000000000001',
    network: coupon.network,
    chain_id: coupon.chainId,
    signer: coupon.signer.toLowerCase(),
    signature: coupon.signature,
    hashed_signature: '0x' + 'aa'.repeat(32),
    state_key: '0x' + 'bb'.repeat(32),
    coupon_manager: CONTRACTS.couponManager.address,
    coupon_address: coupon.couponAddress.toLowerCase(),
    checks: coupon.checks,
    discount_type: coupon.discountType,
    discount_ppm: coupon.discount,
    root: collectionsRoot(coupon.collections),
    collections: coupon.collections.map(c => c.toLowerCase()),
    effective_since: new Date(coupon.checks.effective),
    expires_at: new Date(coupon.checks.expiration),
    created_at: new Date()
  }
}

beforeEach(() => {
  creator = Wallet.createRandom() as unknown as Wallet
  dbQueryMock = jest.fn()
  dbClientQueryMock = jest.fn()
  pg = createTestPgComponent({
    query: dbQueryMock,
    withTransaction: jest.fn().mockImplementation(async (callback, onError) => {
      try {
        return await callback({ query: dbClientQueryMock, release: jest.fn() })
      } catch (error) {
        await onError(error)
        throw error
      }
    })
  })
  readIndexesMock = jest.fn().mockResolvedValue({ contractSignatureIndex: 0, signerSignatureIndex: 0 })
  readStateMock = jest.fn().mockResolvedValue({ uses: 0, cancelled: false })
  chain = { readIndexes: readIndexesMock, readState: readStateMock }
  coupons = createCouponsComponent(
    {
      dappsDatabase: pg,
      logs: createTestLogsComponent({
        getLogger: jest.fn().mockReturnValue({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), log: jest.fn() })
      })
    },
    { chain }
  )
})

describe('when adding a coupon', () => {
  describe('and the caller is not the signer of the coupon', () => {
    it('should reject it, so nobody can put a sale on another creator collections', async () => {
      const coupon = await buildCoupon()
      await expect(coupons.addCoupon(coupon, Wallet.createRandom().address)).rejects.toThrow(InvalidCouponSignerError)
    })
  })

  describe('and the chain has no coupon deployment', () => {
    it('should reject it', async () => {
      const coupon = await buildCoupon({ chainId: ChainId.ETHEREUM_MAINNET })
      await expect(coupons.addCoupon(coupon, creator.address)).rejects.toThrow(UnsupportedCouponChainError)
    })
  })

  describe('and the coupon address is not the collection discount coupon of the chain', () => {
    it('should reject it', async () => {
      const coupon = await buildCoupon({ couponAddress: '0x0000000000000000000000000000000000000009' })
      await expect(coupons.addCoupon(coupon, creator.address)).rejects.toThrow(InvalidCouponAddressError)
    })
  })

  describe('and the discount is not a rate', () => {
    it('should reject it, because a flat discount reverts when it exceeds an item price', async () => {
      const coupon = await buildCoupon({ discountType: 2 })
      await expect(coupons.addCoupon(coupon, creator.address)).rejects.toThrow(InvalidCouponDiscountError)
    })
  })

  describe('and the discount is outside the agreed bounds', () => {
    it('should reject one below 5%', async () => {
      const coupon = await buildCoupon({ discount: 40_000 })
      await expect(coupons.addCoupon(coupon, creator.address)).rejects.toThrow(InvalidCouponDiscountError)
    })

    it('should reject one above 70%', async () => {
      const coupon = await buildCoupon({ discount: 800_000 })
      await expect(coupons.addCoupon(coupon, creator.address)).rejects.toThrow(InvalidCouponDiscountError)
    })
  })

  describe('and the coupon covers no collection', () => {
    it('should reject it', async () => {
      const coupon = await buildCoupon()
      await expect(coupons.addCoupon({ ...coupon, collections: [] }, creator.address)).rejects.toThrow(InvalidCouponCollectionsError)
    })
  })

  describe('and the window is not one a buyer could ever use', () => {
    it('should reject an expiration already in the past', async () => {
      const coupon = await buildCoupon({ checks: buildChecks({ expiration: Date.now() - 1000 }) })
      await expect(coupons.addCoupon(coupon, creator.address)).rejects.toThrow(InvalidCouponChecksError)
    })

    it('should reject a sale that becomes effective after it expires', async () => {
      const now = Date.now()
      const coupon = await buildCoupon({ checks: buildChecks({ effective: now + 2 * DAY, expiration: now + DAY }) })
      await expect(coupons.addCoupon(coupon, creator.address)).rejects.toThrow(InvalidCouponChecksError)
    })

    it('should reject a sale running longer than 30 days', async () => {
      const coupon = await buildCoupon({ checks: buildChecks({ expiration: Date.now() + 31 * DAY }) })
      await expect(coupons.addCoupon(coupon, creator.address)).rejects.toThrow(InvalidCouponChecksError)
    })

    it('should reject one with no uses left to give', async () => {
      const coupon = await buildCoupon({ checks: buildChecks({ uses: 0 }) })
      await expect(coupons.addCoupon(coupon, creator.address)).rejects.toThrow(InvalidCouponChecksError)
    })
  })

  describe('and the coupon restricts who may use it', () => {
    it('should reject an allowed root, because the Shop applies the coupon for whoever is buying', async () => {
      const coupon = await buildCoupon({ checks: buildChecks({ allowedRoot: '0x' + '22'.repeat(32) }) })
      await expect(coupons.addCoupon(coupon, creator.address)).rejects.toThrow(InvalidCouponChecksError)
    })

    it('should reject external checks for the same reason', async () => {
      const coupon = await buildCoupon({
        checks: buildChecks({
          externalChecks: [{ contractAddress: '0x' + '33'.repeat(20), selector: '0x12345678', value: '0x', required: true }]
        })
      })
      await expect(coupons.addCoupon(coupon, creator.address)).rejects.toThrow(InvalidCouponChecksError)
    })
  })

  describe('and the signature does not belong to the signer', () => {
    it('should reject a coupon signed by somebody else', async () => {
      const stranger = Wallet.createRandom()
      const coupon = await buildCoupon()
      const data = encodeCouponData(coupon.discountType, coupon.discount, collectionsRoot(coupon.collections))
      const signature = await stranger.signTypedData(
        getCouponManagerDomain(CHAIN_ID, CONTRACTS),
        COUPON_TYPES,
        getCouponTypedValues(coupon.checks, coupon.couponAddress, data)
      )
      await expect(coupons.addCoupon({ ...coupon, signature }, creator.address)).rejects.toThrow(InvalidCouponSignatureError)
    })

    it('should reject a discount raised after signing', async () => {
      const coupon = await buildCoupon()
      await expect(coupons.addCoupon({ ...coupon, discount: 700_000 }, creator.address)).rejects.toThrow(InvalidCouponSignatureError)
    })

    it('should reject a malformed signature instead of failing later', async () => {
      const coupon = await buildCoupon({ signature: '0xdead' })
      await expect(coupons.addCoupon(coupon, creator.address)).rejects.toThrow(InvalidCouponSignatureError)
    })
  })

  describe('and the signer does not own one of the collections', () => {
    it('should reject it, which is what stops a sale on somebody else items', async () => {
      dbQueryMock.mockResolvedValueOnce({ rows: [{ id: COLLECTION, creator: Wallet.createRandom().address }], rowCount: 1 })
      const coupon = await buildCoupon()
      await expect(coupons.addCoupon(coupon, creator.address)).rejects.toThrow(NotCollectionCreatorError)
    })

    it('should reject a collection the indexer has never seen', async () => {
      dbQueryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 })
      const coupon = await buildCoupon()
      await expect(coupons.addCoupon(coupon, creator.address)).rejects.toThrow(NotCollectionCreatorError)
    })

    it('should look the creator up on the coupon own chain, since the same address is another contract elsewhere', async () => {
      dbQueryMock.mockResolvedValueOnce({ rows: [{ id: COLLECTION, creator: creator.address }], rowCount: 1 })
      dbClientQueryMock.mockResolvedValue({ rows: [], rowCount: 0 })
      const coupon = await buildCoupon()
      await coupons.addCoupon(coupon, creator.address).catch(() => undefined)
      expect(dbQueryMock.mock.calls[0][0].values).toContain(CHAIN_ID)
    })
  })

  describe('and the signature indexes no longer match the manager', () => {
    it('should reject it rather than advertise a sale that would fail at checkout', async () => {
      dbQueryMock.mockResolvedValueOnce({ rows: [{ id: COLLECTION, creator: creator.address }], rowCount: 1 })
      readIndexesMock.mockResolvedValueOnce({ contractSignatureIndex: 0, signerSignatureIndex: 3 })
      const coupon = await buildCoupon()
      await expect(coupons.addCoupon(coupon, creator.address)).rejects.toThrow(InvalidCouponSignatureIndexError)
    })
  })

  describe('and the network does not match the chain the signature is bound to', () => {
    it('should reject it, so later queries that filter by network cannot mis-attribute the coupon', async () => {
      const coupon = await buildCoupon({ network: Network.ETHEREUM })
      await expect(coupons.addCoupon(coupon, creator.address)).rejects.toThrow(InvalidCouponNetworkError)
    })
  })

  describe('and the sale is scheduled far beyond the horizon', () => {
    it('should reject it rather than overflow the date the insert builds', async () => {
      const effective = Date.now() + 400 * DAY
      const coupon = await buildCoupon({ checks: buildChecks({ effective, expiration: effective + DAY }) })
      await expect(coupons.addCoupon(coupon, creator.address)).rejects.toThrow(InvalidCouponChecksError)
    })
  })

  describe('and the chain already refuses the coupon', () => {
    beforeEach(() => {
      dbQueryMock.mockResolvedValueOnce({ rows: [{ id: COLLECTION, creator: creator.address }], rowCount: 1 })
    })

    it('should reject one whose signature was already cancelled', async () => {
      readStateMock.mockResolvedValueOnce({ uses: 0, cancelled: true })
      const coupon = await buildCoupon()
      await expect(coupons.addCoupon(coupon, creator.address)).rejects.toThrow(CouponAlreadyUnusableError)
    })

    it('should reject one whose uses are already spent', async () => {
      readStateMock.mockResolvedValueOnce({ uses: 10, cancelled: false })
      const coupon = await buildCoupon({ checks: buildChecks({ uses: 10 }) })
      await expect(coupons.addCoupon(coupon, creator.address)).rejects.toThrow(CouponAlreadyUnusableError)
    })
  })

  describe('and everything checks out', () => {
    let coupon: CouponCreation

    beforeEach(async () => {
      coupon = await buildCoupon()
      dbQueryMock.mockResolvedValueOnce({ rows: [{ id: COLLECTION, creator: creator.address }], rowCount: 1 })
      dbClientQueryMock.mockResolvedValueOnce({ rows: [buildRow(coupon)], rowCount: 1 }).mockResolvedValueOnce({ rows: [], rowCount: 1 })
    })

    it('should store it and hand back an active coupon with its on-chain state', async () => {
      const stored = await coupons.addCoupon(coupon, creator.address)
      expect(stored.status).toEqual('active')
      expect(stored.discount).toEqual(300_000)
      expect(stored.collections).toEqual([COLLECTION])
      expect(stored.state).toEqual(expect.objectContaining({ uses: 0, cancelled: false }))
    })

    it('should seed the state row from the chain in the same transaction as the coupon', async () => {
      await coupons.addCoupon(coupon, creator.address)
      expect(readStateMock).toHaveBeenCalled()
      expect(dbClientQueryMock).toHaveBeenCalledTimes(2)
    })
  })

  describe('and the same signature was already stored', () => {
    it('should report a conflict instead of a generic failure', async () => {
      const coupon = await buildCoupon()
      dbQueryMock.mockResolvedValueOnce({ rows: [{ id: COLLECTION, creator: creator.address }], rowCount: 1 })
      // Shaped like a real Postgres rejection: the component keys off the SQLSTATE, not the message text,
      // which is localised.
      const uniqueViolation = Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' })
      dbClientQueryMock.mockRejectedValueOnce(uniqueViolation)
      await expect(coupons.addCoupon(coupon, creator.address)).rejects.toThrow(DuplicateCouponError)
    })
  })
})

describe('when refreshing the on-chain state of the live coupons', () => {
  const SIGNER = '0x1111111111111111111111111111111111111111'
  let rows: Record<string, unknown>[]

  beforeEach(() => {
    rows = [
      {
        id: 'a',
        chain_id: CHAIN_ID,
        coupon_manager: CONTRACTS.couponManager.address,
        state_key: '0x01',
        signer: SIGNER,
        checks: { ...buildChecks(), contractSignatureIndex: 0, signerSignatureIndex: 0 }
      },
      {
        id: 'b',
        chain_id: CHAIN_ID,
        coupon_manager: CONTRACTS.couponManager.address,
        state_key: '0x02',
        signer: SIGNER,
        checks: { ...buildChecks(), contractSignatureIndex: 0, signerSignatureIndex: 0 }
      }
    ]
    dbQueryMock.mockResolvedValueOnce({ rows, rowCount: rows.length }).mockResolvedValue({ rows: [], rowCount: 0 })
  })

  describe('and every read succeeds', () => {
    it('should write back what the manager reports for each one', async () => {
      readStateMock.mockResolvedValue({ uses: 4, cancelled: false })
      expect(await coupons.refreshState()).toEqual(2)
    })

    it('should read the signature indexes once per signer rather than once per coupon', async () => {
      readStateMock.mockResolvedValue({ uses: 0, cancelled: false })
      await coupons.refreshState()
      expect(readIndexesMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('and the signer bumped their signature index to end every sale at once', () => {
    it('should mark the coupons revoked, which cancelSignature alone would never show', async () => {
      readStateMock.mockResolvedValue({ uses: 0, cancelled: false })
      readIndexesMock.mockResolvedValue({ contractSignatureIndex: 0, signerSignatureIndex: 1 })
      await coupons.refreshState()
      const written = dbQueryMock.mock.calls.slice(1).map(call => call[0].values)
      expect(written.every(values => values.includes(true))).toBe(true)
    })
  })

  describe('and one of the reads fails', () => {
    it('should keep going, so a single unreachable RPC call does not freeze every other sale', async () => {
      readStateMock.mockRejectedValueOnce(new Error('RPC timeout')).mockResolvedValueOnce({ uses: 1, cancelled: false })
      expect(await coupons.refreshState()).toEqual(1)
    })
  })
})
