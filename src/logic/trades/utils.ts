/* eslint-disable @typescript-eslint/naming-convention */
import { TypedDataField, hexlify, TypedDataDomain, verifyTypedData, toBeArray, toUtf8Bytes, zeroPadValue } from 'ethers'
import { TradeAsset, TradeAssetType, TradeCreation } from '@dcl/schemas'
import { ContractData, ContractName, getContract } from 'decentraland-transactions'
import { MarketplaceContractNotFound } from '../../ports/trades/errors'
import { fromMillisecondsToSeconds } from '../date'

export function getValueFromTradeAsset(asset: TradeAsset) {
  switch (asset.assetType) {
    case TradeAssetType.COLLECTION_ITEM:
      return asset.itemId
    case TradeAssetType.ERC20:
      return asset.amount
    case TradeAssetType.ERC721:
      return asset.tokenId
    default:
      throw new Error('Unsupported asset type')
  }
}

export const MARKETPLACE_TRADE_TYPES: Record<string, TypedDataField[]> = {
  Trade: [
    { name: 'checks', type: 'Checks' },
    { name: 'sent', type: 'AssetWithoutBeneficiary[]' },
    { name: 'received', type: 'Asset[]' }
  ],
  Asset: [
    { name: 'assetType', type: 'uint256' },
    { name: 'contractAddress', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'extra', type: 'bytes' },
    { name: 'beneficiary', type: 'address' }
  ],
  AssetWithoutBeneficiary: [
    { name: 'assetType', type: 'uint256' },
    { name: 'contractAddress', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'extra', type: 'bytes' }
  ],
  Checks: [
    { name: 'uses', type: 'uint256' },
    { name: 'expiration', type: 'uint256' },
    { name: 'effective', type: 'uint256' },
    { name: 'salt', type: 'bytes32' },
    { name: 'contractSignatureIndex', type: 'uint256' },
    { name: 'signerSignatureIndex', type: 'uint256' },
    { name: 'allowedRoot', type: 'bytes32' },
    { name: 'externalChecks', type: 'ExternalCheck[]' }
  ],
  ExternalCheck: [
    { name: 'contractAddress', type: 'address' },
    { name: 'selector', type: 'bytes4' },
    { name: 'value', type: 'uint256' },
    { name: 'required', type: 'bool' }
  ]
}

export function validateTradeSignature(trade: TradeCreation, signer: string): boolean {
  let offChainMarketplaceContract: ContractData
  try {
    offChainMarketplaceContract = getContract(ContractName.OffChainMarketplace, trade.chainId)
  } catch (e) {
    throw new MarketplaceContractNotFound(trade.chainId, trade.network)
  }

  const SALT = zeroPadValue(toBeArray(trade.chainId), 32)
  const domain: TypedDataDomain = {
    name: offChainMarketplaceContract.name,
    version: offChainMarketplaceContract.version,
    salt: SALT,
    verifyingContract: offChainMarketplaceContract.address
  }

  const values = {
    checks: {
      uses: trade.checks.uses,
      expiration: fromMillisecondsToSeconds(trade.checks.expiration),
      effective: fromMillisecondsToSeconds(trade.checks.effective),
      salt: zeroPadValue(trade.checks.salt, 32),
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
      extra: hexlify(toUtf8Bytes(asset.extra))
    })),
    received: trade.received.map(asset => ({
      assetType: asset.assetType,
      contractAddress: asset.contractAddress,
      value: getValueFromTradeAsset(asset),
      extra: hexlify(toUtf8Bytes(asset.extra)),
      beneficiary: asset.beneficiary
    }))
  }

  return verifyTypedData(domain, MARKETPLACE_TRADE_TYPES, values, trade.signature).toLowerCase() === signer
}
