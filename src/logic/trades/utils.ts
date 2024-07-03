/* eslint-disable @typescript-eslint/naming-convention */
import { TypedDataField, ethers } from 'ethers'
import { TradeAsset, TradeAssetType, TradeCreation } from '@dcl/schemas'
import { ContractData, ContractName, getContract } from 'decentraland-transactions'
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

export function validateTradeSignature(trade: TradeCreation, signer: string): boolean {
  let offChainMarketplaceContract: ContractData
  try {
    offChainMarketplaceContract = getContract(ContractName.OffChainMarketplace, trade.chainId)
  } catch (e) {
    return false
  }

  const domain: ethers.TypedDataDomain = {
    name: offChainMarketplaceContract.name,
    version: offChainMarketplaceContract.version,
    chainId: trade.chainId,
    verifyingContract: offChainMarketplaceContract.address
  }

  const types: Record<string, TypedDataField[]> = {
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

  const values = {
    checks: {
      uses: trade.checks.uses,
      expiration: fromMillisecondsToSeconds(trade.checks.expiration),
      effective: fromMillisecondsToSeconds(trade.checks.effective),
      salt: ethers.zeroPadValue(trade.checks.salt, 32),
      contractSignatureIndex: trade.checks.contractSignatureIndex,
      signerSignatureIndex: trade.checks.signerSignatureIndex,
      allowedRoot: ethers.zeroPadValue(trade.checks.salt, 32),
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

  return ethers.verifyTypedData(domain, types, values, trade.signature).toLowerCase() === signer
}
