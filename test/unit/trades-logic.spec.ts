/* eslint-disable @typescript-eslint/naming-convention */
import { HDNodeWallet, TypedDataDomain, Wallet, zeroPadValue, toBeArray } from 'ethers'
import { ChainId, Network, TradeAssetType, TradeCreation, TradeType } from '@dcl/schemas'
import { ContractData, ContractName, getContract } from 'decentraland-transactions'
import { fromMillisecondsToSeconds } from '../../src/logic/date'
import { MARKETPLACE_TRADE_TYPES, getValueFromTradeAsset, validateTradeSignature } from '../../src/logic/trades/utils'
import { MarketplaceContractNotFound } from '../../src/ports/trades/errors'

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
    const offChainMarketplaceContract: ContractData = getContract(ContractName.OffChainMarketplace, chainId)
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
