import { Wallet, keccak256, AbiCoder, concat } from 'ethers'
import { ChainId } from '@dcl/schemas'
import { ContractName } from 'decentraland-transactions'
import { collectionLeaf, collectionProof, collectionsRoot, verifyCollectionProof } from '../../src/logic/coupons/merkle'
import {
  COUPON_TYPES,
  CouponContracts,
  couponDigest,
  digestCouponStateKey,
  DISCOUNT_TYPE_RATE,
  encodeCouponData,
  getCouponContracts,
  getCouponManagerDomain,
  getCouponMarketplacePairings,
  CouponMarketplacePairing,
  getCouponTypedValues,
  legacyCouponStateKey,
  resolveCouponSignature,
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

describe('when resolving the coupon contracts of a chain', () => {
  let contracts: CouponContracts[]

  describe('and the chain is Polygon mainnet, where two marketplace versions are live', () => {
    beforeEach(() => {
      contracts = getCouponContracts(ChainId.MATIC_MAINNET)
    })

    it('should pair each version with its own manager, newest first, sharing the one discount coupon', () => {
      expect(contracts).toEqual([
        {
          marketplace: ContractName.OffChainMarketplaceV3,
          couponManager: { address: '0x655fdfa91d69ea49f4ce1a8f7f7e2622c8630813', name: 'CouponManager', version: '1.0.0' },
          collectionDiscountCoupon: '0xc914507fe297b2dddd1232ac3a8903f1c125e794'
        },
        {
          marketplace: ContractName.OffChainMarketplaceV2,
          couponManager: { address: '0x3fd3056ee72a2a85e9392fab3a450e7736536081', name: 'CouponManager', version: '1.0.0' },
          collectionDiscountCoupon: '0xc914507fe297b2dddd1232ac3a8903f1c125e794'
        }
      ])
    })
  })

  describe('and the chain is Amoy', () => {
    beforeEach(() => {
      contracts = getCouponContracts(ChainId.MATIC_AMOY)
    })

    it('should pair each version with its own manager there as well', () => {
      expect(contracts.map(({ marketplace, couponManager }) => [marketplace, couponManager.address])).toEqual([
        [ContractName.OffChainMarketplaceV3, '0x6c956587d9fe70032781edcdc626310648575382'],
        [ContractName.OffChainMarketplaceV2, '0xa40b1d129b8906888720686f3a01921ddf37716f']
      ])
    })
  })

  describe('and the chain has no collections', () => {
    beforeEach(() => {
      contracts = getCouponContracts(ChainId.ETHEREUM_MAINNET)
    })

    it('should resolve nothing', () => {
      expect(contracts).toEqual([])
    })
  })
})

describe('when pairing every coupon manager with the marketplace that redeems through it', () => {
  let pairings: CouponMarketplacePairing[]

  beforeEach(() => {
    pairings = getCouponMarketplacePairings()
  })

  it('should pair each Polygon mainnet version with its own manager, lowercased', () => {
    expect(pairings.filter(pairing => pairing.chainId === ChainId.MATIC_MAINNET)).toEqual([
      {
        chainId: ChainId.MATIC_MAINNET,
        marketplace: '0xe38ef22abe871513555cba89adfe45ab4f548ada',
        couponManager: '0x655fdfa91d69ea49f4ce1a8f7f7e2622c8630813'
      },
      {
        chainId: ChainId.MATIC_MAINNET,
        marketplace: '0xa40b1d129b8906888720686f3a01921ddf37716f',
        couponManager: '0x3fd3056ee72a2a85e9392fab3a450e7736536081'
      }
    ])
  })

  it('should pair the Amoy versions as well', () => {
    expect(pairings.filter(pairing => pairing.chainId === ChainId.MATIC_AMOY).map(pairing => pairing.couponManager)).toEqual([
      '0x6c956587d9fe70032781edcdc626310648575382',
      '0xa40b1d129b8906888720686f3a01921ddf37716f'
    ])
  })

  it('should list nothing for the chains without collections', () => {
    expect(
      pairings.filter(pairing => pairing.chainId === ChainId.ETHEREUM_MAINNET || pairing.chainId === ChainId.ETHEREUM_SEPOLIA)
    ).toEqual([])
  })
})

describe('when verifying a coupon signature', () => {
  const chainId = ChainId.MATIC_MAINNET
  const [contracts] = getCouponContracts(chainId)
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

describe('when resolving which manager a coupon was signed against', () => {
  const chainId = ChainId.MATIC_MAINNET
  const candidates = getCouponContracts(chainId)
  const [current, previous] = candidates
  if (!current || !previous) {
    throw new Error('Polygon mainnet must have two live coupon managers for these tests to mean anything')
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
  let resolved: CouponContracts | null

  async function sign(contracts: CouponContracts): Promise<string> {
    return creator.signTypedData(
      getCouponManagerDomain(chainId, contracts),
      COUPON_TYPES,
      getCouponTypedValues(checks, contracts.collectionDiscountCoupon, data)
    )
  }

  beforeEach(() => {
    creator = Wallet.createRandom() as unknown as Wallet
  })

  describe('and the creator signed against the current marketplace manager', () => {
    beforeEach(async () => {
      signature = await sign(current)
      resolved = resolveCouponSignature(chainId, candidates, checks, current.collectionDiscountCoupon, data, signature, creator.address)
    })

    it('should resolve the V3 pair', () => {
      expect(resolved).toEqual(current)
    })
  })

  describe('and the creator signed against the previous marketplace manager', () => {
    beforeEach(async () => {
      signature = await sign(previous)
      resolved = resolveCouponSignature(chainId, candidates, checks, previous.collectionDiscountCoupon, data, signature, creator.address)
    })

    // The two domains differ only in verifyingContract, so a coupon can never verify against both.
    it('should resolve the V2 pair', () => {
      expect(resolved).toEqual(previous)
    })
  })

  describe('and the signature belongs to somebody else', () => {
    beforeEach(async () => {
      signature = await sign(current)
      resolved = resolveCouponSignature(
        chainId,
        candidates,
        checks,
        current.collectionDiscountCoupon,
        data,
        signature,
        Wallet.createRandom().address
      )
    })

    it('should resolve nothing', () => {
      expect(resolved).toBeNull()
    })
  })
})

describe('when deriving the on-chain state keys of a coupon', () => {
  it('should scope the signature hash by signer, the way the managers keyed on signature bytes do', () => {
    const signer = '0x4c09495cd2d4e3d3fa2808eb655d013de426157b'
    const signature = '0x' + 'ab'.repeat(65)
    // Pinned rather than recomputed: re-expressing the implementation would assert nothing. The second
    // value is what keying on the signature hash alone would produce, which reads zero from every manager
    // forever, so the pair also documents the mistake it guards against.
    expect(legacyCouponStateKey(signer, signature)).toEqual('0x05184e621d5f7d814b6684349ce2a8f07be24de1fa5f124f2914788c049b2ca0')
    expect(keccak256(signature)).toEqual('0x1090dbec48f7f57f241cd63982ccab202c65844d3a54ee797b1a6de433635179')
  })

  /**
   * Taken from a coupon really applied on Amoy: the CouponManager wrote that use under the digest key
   * below, and the signature key alongside it stayed at zero. Pinning both is what keeps the pair honest,
   * since a key derived correctly but from the wrong handle looks exactly as plausible.
   */
  describe('and the coupon was signed against a manager keyed on the EIP-712 digest', () => {
    const contracts: CouponContracts = {
      marketplace: ContractName.OffChainMarketplaceV3,
      couponManager: { address: '0x6c956587d9fe70032781edcdc626310648575382', name: 'CouponManager', version: '1.0.0' },
      collectionDiscountCoupon: '0x4ee8f6b87f4917a3bbc7c8bb3a06db8555f83db9'
    }
    const signer = '0x747c6f502272129bf1ba872a1903045b837ee86c'
    const signature =
      '0x8dfe3fa6844f0cdf55b7612bffa73bf846b161323f2b05c108f0dac55bd7832871783596ff6286e9f6cfc48d174e800e477d1c84e9b81acd0bc9b5b74407db4a1b'
    const checks = {
      uses: 5,
      expiration: 1789732387809,
      effective: 1789473194471,
      salt: '0x3ecca08a6516479e33cf16ba01b056125a1e2eff4c9777035c0a60d98ebf34d0',
      contractSignatureIndex: 0,
      signerSignatureIndex: 0,
      allowedRoot: '0x',
      externalChecks: []
    }
    const data = encodeCouponData(DISCOUNT_TYPE_RATE, 300_000, '0x69f6a818d79fb8cc8ff81eda2ea5e280154f97013ae27ded14bb8a7e33d24c78')

    it('should rebuild the digest the wallet signed', () => {
      expect(couponDigest(ChainId.MATIC_AMOY, contracts, checks, contracts.collectionDiscountCoupon, data)).toEqual(
        '0x2b001c39e76fd747c79a907071a815b4c72a9a15a1d6e303e9aba11c2fd8650d'
      )
    })

    it('should key the slot the manager really wrote on that digest, not on the signature', () => {
      const digest = couponDigest(ChainId.MATIC_AMOY, contracts, checks, contracts.collectionDiscountCoupon, data)
      expect(digestCouponStateKey(signer, digest)).toEqual('0x3c6b8e7a72677c18bf9579179ba86c80f66a15470474be6c796ae52ae6af1bca')
      expect(legacyCouponStateKey(signer, signature)).not.toEqual(digestCouponStateKey(signer, digest))
    })
  })
})
