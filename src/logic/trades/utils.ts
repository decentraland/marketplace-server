/* eslint-disable @typescript-eslint/naming-convention */
import { TypedDataField, ethers } from 'ethers'
import { TradeAssetType, Trade } from '@dcl/schemas'
import { ContractData, ContractName, getContract } from 'decentraland-transactions'

export function validateTradeByType(trade: Trade): boolean {
  if (trade.type === 'bid') {
    return (
      trade.sent.length === 1 &&
      trade.sent[0].assetType === TradeAssetType.ERC20 &&
      trade.received.length === 1 &&
      trade.received[0].assetType === TradeAssetType.ERC721
    )
  }

  return false
}

export function validateTradeSignature(trade: Trade, signer: string): boolean {
  let offChainMarketplaceContract: ContractData
  try {
    offChainMarketplaceContract = getContract(ContractName.OffChainMarketplace, trade.chainId)
  } catch (e) {
    return false
  }

  const domain: ethers.TypedDataDomain = {
    name: offChainMarketplaceContract.name,
    version: offChainMarketplaceContract.version,
    verifyingContract: offChainMarketplaceContract.address,
    salt: ethers.zeroPadValue(ethers.toBeArray(trade.checks.salt), 32)
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
      expiration: trade.checks.uses,
      effective: trade.checks.effective,
      salt: ethers.zeroPadValue(ethers.toBeArray(trade.checks.salt), 32),
      contractSignatureIndex: trade.checks.contractSignatureIndex,
      signerSignatureIndex: trade.checks.signerSignatureIndex,
      allowedRoot: trade.checks.allowedRoot,
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
      value: asset.value,
      extra: asset.extra
    })),
    received: trade.received.map(asset => ({
      assetType: asset.assetType,
      confirmations: asset.contractAddress,
      value: asset.value,
      extra: asset.extra,
      beneficiary: asset.beneficiary
    }))
  }

  return ethers.verifyTypedData(domain, types, values, trade.signature).toLowerCase() === signer
}
