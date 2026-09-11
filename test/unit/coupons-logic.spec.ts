import { Wallet, keccak256, AbiCoder, concat } from 'ethers'
import { ChainId } from '@dcl/schemas'
import { collectionLeaf, collectionProof, collectionsRoot, verifyCollectionProof } from '../../src/logic/coupons/merkle'
import {
  COUPON_TYPES,
  couponStateKey,
  DISCOUNT_TYPE_RATE,
  encodeCouponData,
  getCouponContracts,
  getCouponManagerDomain,
  getCouponTypedValues,
  verifyCouponSignature
} from '../../src/logic/coupons/signature'

const COLLECTIONS = [
  '0x4c09495cd2d4e3d3fa2808eb655d013de426157b',
  '0xb0d0d31910da4a14d4e05a9d51b6e9a99a85d676',
  '0x7079fda5934f9bdcdfbe9c84e286a04dadfeb9e4',
  '0x96054dc54939d3c632796dbce4884705ed7c8977',
  '0xf8a87150ca602dbeb2e748ad7c9c790d55d10528'
]

describe('when building the collections Merkle tree', () => {
  describe('and the coupon covers a single collection', () => {
    it('should make the root equal to the leaf and the proof empty, as the contract expects for one leaf', () => {
      const [collection] = COLLECTIONS
      const expectedLeaf = keccak256(keccak256(AbiCoder.defaultAbiCoder().encode(['address'], [collection])))
      expect(collectionLeaf(collection)).toEqual(expectedLeaf)
      expect(collectionsRoot([collection])).toEqual(expectedLeaf)
      expect(collectionProof([collection], collection)).toEqual([])
    })
  })

  describe('and the coupon covers two collections', () => {
    it('should hash the sorted pair', () => {
      const [a, b] = [collectionLeaf(COLLECTIONS[0]), collectionLeaf(COLLECTIONS[1])].sort()
      expect(collectionsRoot([COLLECTIONS[0], COLLECTIONS[1]])).toEqual(keccak256(concat([a, b])))
    })
  })

  describe('and the coupon covers several collections', () => {
    it('should produce proofs that recompute the root for every collection', () => {
      const root = collectionsRoot(COLLECTIONS)
      for (const collection of COLLECTIONS) {
        expect(verifyCollectionProof(root, collection, collectionProof(COLLECTIONS, collection))).toBe(true)
      }
    })

    it('should not verify a proof for a collection outside the set', () => {
      const root = collectionsRoot(COLLECTIONS)
      expect(verifyCollectionProof(root, '0x0000000000000000000000000000000000000001', collectionProof(COLLECTIONS, COLLECTIONS[0]))).toBe(
        false
      )
    })

    it('should give the same root whatever the order, casing or duplicates the client sent', () => {
      const shuffled = [...COLLECTIONS].reverse().map(c => c.toUpperCase().replace('0X', '0x'))
      expect(collectionsRoot([...shuffled, COLLECTIONS[2]])).toEqual(collectionsRoot(COLLECTIONS))
    })

    // Pinned on purpose. Every other test here is shape-agnostic — a proof verifies against the root of
    // the same tree that produced it — so they pass under any self-consistent tree and would not notice
    // the layout changing. This value is the StandardMerkleTree root, which is what a client building the
    // tree with @openzeppelin/merkle-tree signs. A tree that pairs level by level and carries an odd node
    // up returns 0xedc52722864df2a9a75b36296621e7ca7314f4211333ee61b2017ca50b13b967 for these same five
    // collections, and would reject every coupon a client signed.
    it('should build the root OpenZeppelin StandardMerkleTree builds, which is what the client signs', () => {
      expect(collectionsRoot(COLLECTIONS)).toEqual('0xbb275d33d9fbb90ff34fd53181283e8cdebb0dd8e764f5cb6852d976a4495fa9')
    })
  })

  describe('and the coupon covers nothing', () => {
    it('should throw', () => {
      expect(() => collectionsRoot([])).toThrow('at least one collection')
    })
  })

  describe('and a proof is requested for a collection outside the set', () => {
    it('should throw', () => {
      expect(() => collectionProof(COLLECTIONS, '0x0000000000000000000000000000000000000001')).toThrow('not covered')
    })
  })
})

describe('when resolving the coupon contracts', () => {
  it('should return the Amoy pair from the transactions library', () => {
    expect(getCouponContracts(ChainId.MATIC_AMOY)).toEqual({
      couponManager: { address: '0x6c956587d9fe70032781edcdc626310648575382', name: 'CouponManager', version: '1.0.0' },
      collectionDiscountCoupon: '0x4ee8f6b87f4917a3bbc7c8bb3a06db8555f83db9'
    })
  })

  it('should return the Polygon mainnet pair from the registry fallback', () => {
    expect(getCouponContracts(ChainId.MATIC_MAINNET)).toEqual({
      couponManager: { address: '0x3fd3056ee72a2a85e9392fab3a450e7736536081', name: 'CouponManager', version: '1.0.0' },
      collectionDiscountCoupon: '0xc914507fe297b2dddd1232ac3a8903f1c125e794'
    })
  })

  it('should return null for a chain without collections', () => {
    expect(getCouponContracts(ChainId.ETHEREUM_MAINNET)).toBeNull()
  })
})

describe('when verifying a coupon signature', () => {
  const chainId = ChainId.MATIC_MAINNET
  const contracts = getCouponContracts(chainId)
  if (!contracts) {
    throw new Error('Polygon mainnet must resolve a coupon pair for these tests to mean anything')
  }
  const checks = {
    uses: 10,
    expiration: 1_800_000_000_000,
    effective: 1_700_000_000_000,
    salt: '0x' + '11'.repeat(32),
    contractSignatureIndex: 0,
    signerSignatureIndex: 0,
    allowedRoot: '0x' + '00'.repeat(32),
    externalChecks: []
  }
  const data = encodeCouponData(DISCOUNT_TYPE_RATE, 300_000, collectionsRoot(COLLECTIONS))
  let creator: Wallet
  let signature: string

  beforeEach(async () => {
    creator = Wallet.createRandom() as unknown as Wallet
    signature = await creator.signTypedData(
      getCouponManagerDomain(chainId, contracts),
      COUPON_TYPES,
      getCouponTypedValues(checks, contracts.collectionDiscountCoupon, data)
    )
  })

  it('should accept the creator signature', () => {
    expect(verifyCouponSignature(chainId, contracts, checks, contracts.collectionDiscountCoupon, data, signature, creator.address)).toBe(
      true
    )
  })

  it('should reject another signer', () => {
    const other = Wallet.createRandom()
    expect(verifyCouponSignature(chainId, contracts, checks, contracts.collectionDiscountCoupon, data, signature, other.address)).toBe(
      false
    )
  })

  it('should reject a coupon whose discount was changed after signing', () => {
    const tampered = encodeCouponData(DISCOUNT_TYPE_RATE, 900_000, collectionsRoot(COLLECTIONS))
    expect(
      verifyCouponSignature(chainId, contracts, checks, contracts.collectionDiscountCoupon, tampered, signature, creator.address)
    ).toBe(false)
  })

  it('should reject a structurally invalid signature instead of throwing', () => {
    expect(verifyCouponSignature(chainId, contracts, checks, contracts.collectionDiscountCoupon, data, '0x1234', creator.address)).toBe(
      false
    )
  })

  it('should encode the coupon data as the contract decodes it', () => {
    expect(data).toHaveLength(2 + 64 * 3)
    expect(BigInt('0x' + data.slice(2, 66))).toEqual(BigInt(DISCOUNT_TYPE_RATE))
    expect(BigInt('0x' + data.slice(66, 130))).toEqual(300_000n)
  })
})

describe('when deriving the on-chain state key of a coupon', () => {
  it('should scope the signature hash by signer, the way the deployed CouponManager does', () => {
    const signer = '0x4c09495cd2d4e3d3fa2808eb655d013de426157b'
    const signature = '0x' + 'ab'.repeat(65)
    // Pinned rather than recomputed: re-expressing the implementation would assert nothing. The second
    // value is what keying on the signature hash alone would produce, which reads zero from the manager
    // forever, so the pair also documents the mistake it guards against.
    expect(couponStateKey(signer, signature)).toEqual('0x05184e621d5f7d814b6684349ce2a8f07be24de1fa5f124f2914788c049b2ca0')
    expect(keccak256(signature)).toEqual('0x1090dbec48f7f57f241cd63982ccab202c65844d3a54ee797b1a6de433635179')
  })
})
