/* eslint-disable @typescript-eslint/naming-convention */
import { HDNodeWallet, TypedDataDomain, TypedDataEncoder, Wallet, zeroPadValue, toBeArray, Contract } from 'ethers'
import { ChainId, Network, TradeAssetType, TradeCreation, TradeType } from '@dcl/schemas'
import { ContractData, ContractName, getContract } from 'decentraland-transactions'
import { fromMillisecondsToSeconds } from '../../src/logic/date'
import {
  MARKETPLACE_TRADE_TYPES,
  getValueFromTradeAsset,
  getOffChainMarketplaceContracts,
  isEstateFingerprintValid,
  resolveTradeSignature,
  validateTradeSignature
} from '../../src/logic/trades/utils'
import { MarketplaceContractNotFound } from '../../src/ports/trades/errors'

jest.mock('ethers', () => {
  const originalModule = jest.requireActual('ethers')
  return {
    ...originalModule,
    Contract: jest.fn()
  }
})

describe('when verifying the trade signature', () => {
  let chainId: ChainId
  let trade: TradeCreation
  let signerAddress: string
  let wallet: HDNodeWallet
  let values: Record<string, any>
  let domain: TypedDataDomain

  beforeEach(async () => {
    wallet = Wallet.createRandom()
    signerAddress = (await wallet.getAddress()).toLowerCase()
    chainId = ChainId.ETHEREUM_SEPOLIA
    const offChainMarketplaceContract: ContractData = getContract(ContractName.OffChainMarketplaceV2, chainId)
    trade = {
      signer: signerAddress,
      chainId: chainId,
      signature: '0x',
      network: Network.ETHEREUM,
      type: TradeType.BID,
      checks: {
        uses: 1,
        expiration: new Date('2023-02-28 00:00:00').getTime(),
        effective: new Date('2023-02-28 00:00:00').getTime(),
        salt: zeroPadValue(toBeArray(chainId), 32),
        allowedRoot: '0x',
        contractSignatureIndex: 0,
        signerSignatureIndex: 0,
        externalChecks: []
      },
      sent: [
        {
          assetType: TradeAssetType.ERC20,
          contractAddress: '0x9d32aac179153a991e832550d9f96441ea27763a',
          amount: '100',
          extra: '0x'
        }
      ],
      received: [
        {
          assetType: TradeAssetType.ERC721,
          contractAddress: '0x9d32aac179153a991e832550d9f96441ea27763b',
          tokenId: '115792089237316195423570985008687907844082360758775225525946469607255387930637',
          extra: '0x',
          beneficiary: '0x9d32aac179153a991e832550d9f96441ea27763b'
        }
      ]
    }

    const SALT = zeroPadValue(toBeArray(trade.chainId), 32)
    domain = {
      name: offChainMarketplaceContract.name,
      version: offChainMarketplaceContract.version,
      salt: SALT,
      verifyingContract: offChainMarketplaceContract.address
    }

    values = {
      checks: {
        uses: trade.checks.uses,
        expiration: fromMillisecondsToSeconds(trade.checks.expiration),
        effective: fromMillisecondsToSeconds(trade.checks.effective),
        salt: SALT,
        contractSignatureIndex: trade.checks.contractSignatureIndex,
        signerSignatureIndex: trade.checks.signerSignatureIndex,
        allowedRoot: zeroPadValue(trade.checks.allowedRoot, 32),
        externalChecks: trade.checks.externalChecks?.map(externalCheck => ({
          contractAddress: externalCheck.contractAddress,
          selector: externalCheck.selector,
          value: externalCheck.value,
          required: externalCheck.required
        }))
      },
      sent: trade.sent.map(asset => ({
        assetType: asset.assetType,
        contractAddress: asset.contractAddress,
        value: getValueFromTradeAsset(asset),
        extra: asset.extra
      })),
      received: trade.received.map(asset => ({
        assetType: asset.assetType,
        contractAddress: asset.contractAddress,
        value: getValueFromTradeAsset(asset),
        extra: asset.extra,
        beneficiary: asset.beneficiary
      }))
    }

    trade.signature = await wallet.signTypedData(domain, MARKETPLACE_TRADE_TYPES, values)
  })

  describe("and there's no contract with the given chain id", () => {
    beforeEach(() => {
      trade.chainId = ChainId.ETHEREUM_KOVAN
    })

    it('should reject into a contract not found error', () => {
      return expect(() => validateTradeSignature(trade, signerAddress)).toThrow(
        new MarketplaceContractNotFound(trade.chainId, trade.network)
      )
    })
  })

  describe('and the signature was signed by a different address', () => {
    let otherAddress: string

    beforeEach(async () => {
      otherAddress = '0x165cd37b4c644c2921454429e7f9358d18a45e14'
      trade = {
        ...trade,
        signer: otherAddress,
        signature: await wallet.signTypedData(domain, MARKETPLACE_TRADE_TYPES, values)
      }
    })

    it('should return false', () => {
      return expect(validateTradeSignature(trade, otherAddress)).toBe(false)
    })
  })

  describe('and the signature was signed by the correct address', () => {
    beforeEach(async () => {
      trade = {
        ...trade,
        signer: signerAddress,
        signature: await wallet.signTypedData(domain, MARKETPLACE_TRADE_TYPES, values)
      }
    })

    it('should return true', () => {
      return expect(validateTradeSignature(trade, signerAddress)).toBe(true)
    })
  })
})

beforeEach(() => {
  jest.resetAllMocks()
})

describe('when validating the estate signature', () => {
  let contractAddress: string
  let tokenId: string
  let chainId: ChainId
  let fingerprint: string

  beforeEach(() => {
    contractAddress = '0x9d32aac179153a991e832550d9f96441ea27763b'
    tokenId = '5801'
    chainId = ChainId.ETHEREUM_MAINNET
    fingerprint = '0x1234567890'
  })

  describe('and the chain id is from a not supported chain', () => {
    beforeEach(() => {
      chainId = ChainId.AVALANCHE_MAINNET
    })

    it('should reject with an error', () => {
      return expect(isEstateFingerprintValid(contractAddress, tokenId, chainId, fingerprint)).rejects.toThrow(Error)
    })
  })

  describe('and the fingerprint is the same as the estate fingerprint', () => {
    beforeEach(() => {
      ;(Contract as jest.Mock).mockImplementationOnce(() => {
        return {
          getFingerprintV2: () => Promise.resolve(fingerprint)
        }
      })
    })

    it('should return true', () => {
      return expect(isEstateFingerprintValid(contractAddress, tokenId, chainId, fingerprint)).resolves.toBe(true)
    })
  })

  describe('and the fingerprint is different from the estate fingerprint', () => {
    beforeEach(() => {
      ;(Contract as jest.Mock).mockImplementationOnce(() => {
        return {
          getFingerprintV2: () => Promise.resolve('0x')
        }
      })
    })

    it('should return false', () => {
      return expect(isEstateFingerprintValid(contractAddress, tokenId, chainId, fingerprint)).resolves.toBe(false)
    })
  })
})

describe('when getting the value from a trade asset', () => {
  describe('and the asset is a USD-pegged MANA asset', () => {
    it('should return the amount', () => {
      expect(
        getValueFromTradeAsset({
          assetType: TradeAssetType.USD_PEGGED_MANA,
          contractAddress: '0x9d32aac179153a991e832550d9f96441ea27763a',
          amount: '1000000000000000000',
          extra: '0x'
        })
      ).toBe('1000000000000000000')
    })
  })
})

describe('when resolving which marketplace version a trade signature belongs to', () => {
  let chainId: ChainId
  let wallet: HDNodeWallet
  let signerAddress: string
  let trade: TradeCreation
  let values: Record<string, unknown>

  beforeEach(async () => {
    wallet = Wallet.createRandom()
    signerAddress = (await wallet.getAddress()).toLowerCase()
    // Sepolia has both a V2 and a V3 deployment, so both are real candidates here.
    chainId = ChainId.ETHEREUM_SEPOLIA
    trade = {
      signer: signerAddress,
      chainId,
      signature: '0x',
      network: Network.ETHEREUM,
      type: TradeType.BID,
      checks: {
        uses: 1,
        expiration: new Date('2023-02-28 00:00:00').getTime(),
        effective: new Date('2023-02-28 00:00:00').getTime(),
        salt: zeroPadValue(toBeArray(chainId), 32),
        allowedRoot: '0x',
        contractSignatureIndex: 0,
        signerSignatureIndex: 0,
        externalChecks: []
      },
      sent: [
        {
          assetType: TradeAssetType.ERC20,
          contractAddress: '0x9d32aac179153a991e832550d9f96441ea27763a',
          amount: '100',
          extra: '0x'
        }
      ],
      received: [
        {
          assetType: TradeAssetType.ERC721,
          contractAddress: '0x9d32aac179153a991e832550d9f96441ea27763b',
          tokenId: '1',
          extra: '0x',
          beneficiary: '0x9d32aac179153a991e832550d9f96441ea27763b'
        }
      ]
    }
    values = {
      checks: {
        uses: trade.checks.uses,
        expiration: fromMillisecondsToSeconds(trade.checks.expiration),
        effective: fromMillisecondsToSeconds(trade.checks.effective),
        salt: zeroPadValue(trade.checks.salt, 32),
        contractSignatureIndex: trade.checks.contractSignatureIndex,
        signerSignatureIndex: trade.checks.signerSignatureIndex,
        allowedRoot: zeroPadValue(trade.checks.allowedRoot, 32),
        externalChecks: []
      },
      sent: trade.sent.map(asset => ({
        assetType: asset.assetType,
        contractAddress: asset.contractAddress,
        value: getValueFromTradeAsset(asset),
        extra: asset.extra
      })),
      received: trade.received.map(asset => ({
        assetType: asset.assetType,
        contractAddress: asset.contractAddress,
        value: getValueFromTradeAsset(asset),
        extra: asset.extra,
        beneficiary: 'beneficiary' in asset ? asset.beneficiary : undefined
      }))
    }
  })

  describe('and the trade was signed against the V3 marketplace', () => {
    let marketplace: ContractData
    let domain: TypedDataDomain

    beforeEach(async () => {
      marketplace = getContract(ContractName.OffChainMarketplaceV3, chainId)
      domain = {
        name: marketplace.name,
        version: marketplace.version,
        salt: zeroPadValue(toBeArray(chainId), 32),
        verifyingContract: marketplace.address
      }
      trade.signature = await wallet.signTypedData(domain, MARKETPLACE_TRADE_TYPES, values)
    })

    it('should report V3 as the contract the signature belongs to', () => {
      expect(resolveTradeSignature(trade, signerAddress)?.contract.address).toBe(marketplace.address)
    })

    it('should return the EIP-712 digest under the V3 domain, which is what V3 keys cancellations on', () => {
      expect(resolveTradeSignature(trade, signerAddress)?.cancellationDigest).toBe(
        TypedDataEncoder.hash(domain, MARKETPLACE_TRADE_TYPES, values)
      )
    })

    it('should consider the signature valid', () => {
      expect(validateTradeSignature(trade, signerAddress)).toBe(true)
    })
  })

  describe('and the trade was signed against the V2 marketplace', () => {
    let marketplace: ContractData
    let domain: TypedDataDomain

    beforeEach(async () => {
      marketplace = getContract(ContractName.OffChainMarketplaceV2, chainId)
      domain = {
        name: marketplace.name,
        version: marketplace.version,
        salt: zeroPadValue(toBeArray(chainId), 32),
        verifyingContract: marketplace.address
      }
      trade.signature = await wallet.signTypedData(domain, MARKETPLACE_TRADE_TYPES, values)
    })

    // A trade signed against the older version must keep working while clients roll over to V3.
    it('should report V2 as the contract the signature belongs to', () => {
      expect(resolveTradeSignature(trade, signerAddress)?.contract.address).toBe(marketplace.address)
    })

    // V2 keys cancellations on keccak256(signature bytes), which the trade already stores as
    // hashed_signature. Storing a digest here would leave trade_digest meaning something different on
    // each side of the indexer join, since the indexer only records one for V3.
    it('should not return a cancellation digest, because V2 does not key cancellations on one', () => {
      expect(resolveTradeSignature(trade, signerAddress)?.cancellationDigest).toBeNull()
    })
  })

  describe('and the signature belongs to a different signer', () => {
    beforeEach(async () => {
      const marketplace = getContract(ContractName.OffChainMarketplaceV3, chainId)
      trade.signature = await wallet.signTypedData(
        {
          name: marketplace.name,
          version: marketplace.version,
          salt: zeroPadValue(toBeArray(chainId), 32),
          verifyingContract: marketplace.address
        },
        MARKETPLACE_TRADE_TYPES,
        values
      )
    })

    it('should return null rather than matching any version', () => {
      expect(resolveTradeSignature(trade, '0x165cd37b4c644c2921454429e7f9358d18a45e14')).toBeNull()
    })
  })

  describe('and no marketplace version is deployed on the chain', () => {
    beforeEach(async () => {
      // Signed first, then moved to an unsupported chain: the ECDSA shape check runs before contract
      // lookup, so an unsigned trade would fail on that instead of on the missing contract.
      const marketplace = getContract(ContractName.OffChainMarketplaceV3, chainId)
      trade.signature = await wallet.signTypedData(
        {
          name: marketplace.name,
          version: marketplace.version,
          salt: zeroPadValue(toBeArray(chainId), 32),
          verifyingContract: marketplace.address
        },
        MARKETPLACE_TRADE_TYPES,
        values
      )
      trade.chainId = ChainId.ETHEREUM_KOVAN
    })

    it('should throw a contract not found error', () => {
      expect(() => resolveTradeSignature(trade, signerAddress)).toThrow(new MarketplaceContractNotFound(trade.chainId, trade.network))
    })
  })
})

/**
 * A fixed wallet, signature and digest, all hardcoded rather than recomputed in the spec.
 *
 * The other digest assertions rebuild the domain and values with the same formulas the implementation
 * uses, so a mistake shared by both sides passes. These constants were produced once and pin the whole
 * chain: the registry's V3 address, name and version, the EIP-712 type definitions, the values
 * construction and the digest formula. If any of them drifts, the digest stops matching the value the
 * marketplace contract keys cancellations on, and this fails.
 */
const FIXED_SIGNER = '0x19e7e376e7c213b7e7e7e46cc70a5dd086daff2a'
const FIXED_V3_SEPOLIA_SIGNATURE =
  '0x2c1a7d8bde8ae3922ce3b4aea5086c78b5bfd77766acb4f98961c8219ce78dd76d5aad966ad515e8d5d40517f17013a903d4cd4ae74e46b3dcb91b0c5f9d17c91c'
const FIXED_V3_SEPOLIA_DIGEST = '0x491822dfcfd83072053748ee442b3c7d9f16b7827bad93773faf23e71fd82fcb'

describe('when resolving a known-good V3 signature against fixed expectations', () => {
  let trade: TradeCreation

  beforeEach(() => {
    trade = {
      signer: FIXED_SIGNER,
      chainId: ChainId.ETHEREUM_SEPOLIA,
      signature: FIXED_V3_SEPOLIA_SIGNATURE,
      network: Network.ETHEREUM,
      type: TradeType.BID,
      checks: {
        uses: 1,
        expiration: new Date('2023-02-28 00:00:00').getTime(),
        effective: new Date('2023-02-28 00:00:00').getTime(),
        salt: '0x07',
        allowedRoot: '0x',
        contractSignatureIndex: 0,
        signerSignatureIndex: 0,
        externalChecks: []
      },
      sent: [
        {
          assetType: TradeAssetType.ERC20,
          contractAddress: '0x9d32aac179153a991e832550d9f96441ea27763a',
          amount: '100',
          extra: '0x'
        }
      ],
      received: [
        {
          assetType: TradeAssetType.ERC721,
          contractAddress: '0x9d32aac179153a991e832550d9f96441ea27763b',
          tokenId: '1',
          extra: '0x',
          beneficiary: '0x9d32aac179153a991e832550d9f96441ea27763b'
        }
      ]
    } as TradeCreation
  })

  it('should resolve to the V3 marketplace', () => {
    expect(resolveTradeSignature(trade, FIXED_SIGNER)?.contract.address).toBe(
      getContract(ContractName.OffChainMarketplaceV3, ChainId.ETHEREUM_SEPOLIA).address
    )
  })

  it('should produce the digest the marketplace keys cancellations on', () => {
    expect(resolveTradeSignature(trade, FIXED_SIGNER)?.cancellationDigest).toBe(FIXED_V3_SEPOLIA_DIGEST)
  })

  describe('and the signature is malleated to a non-canonical high s', () => {
    beforeEach(() => {
      trade = { ...trade, signature: '0x' + 'ff'.repeat(64) + '1b' }
    })

    // ethers THROWS on a non-canonical s rather than recovering a different address, and that is exactly
    // the malleability case V3 was deployed to fix. It has to read as an invalid signature, so the caller
    // answers 400, not as an unhandled error the caller answers 500 for.
    it('should report no match rather than letting the error escape', () => {
      expect(resolveTradeSignature(trade, FIXED_SIGNER)).toBeNull()
    })
  })

  describe('and r is outside the curve order', () => {
    beforeEach(() => {
      trade = { ...trade, signature: '0x' + '00'.repeat(64) + '1b' }
    })

    it('should report no match rather than letting the error escape', () => {
      expect(resolveTradeSignature(trade, FIXED_SIGNER)).toBeNull()
    })
  })
})

describe('when listing the marketplace versions deployed on a chain', () => {
  describe('and the chain has both V2 and V3', () => {
    it('should list V3 before V2, so a trade settles on the newest deployment', () => {
      expect(getOffChainMarketplaceContracts(ChainId.MATIC_AMOY).map(({ contractName }) => contractName)).toEqual([
        ContractName.OffChainMarketplaceV3,
        ContractName.OffChainMarketplaceV2
      ])
    })
  })

  describe('and the chain has no V3 deployment', () => {
    // The path every mainnet trade takes: getContract throws for V3 and the candidate is skipped. V3 is
    // testnet-only, so this is production behaviour, not an edge case.
    it('should list V2 alone rather than throwing', () => {
      expect(getOffChainMarketplaceContracts(ChainId.MATIC_MAINNET).map(({ contractName }) => contractName)).toEqual([
        ContractName.OffChainMarketplaceV2
      ])
    })
  })
})
