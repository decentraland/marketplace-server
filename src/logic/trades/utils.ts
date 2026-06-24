/* eslint-disable @typescript-eslint/naming-convention */
import { Contract, TypedDataField, TypedDataDomain, verifyTypedData, toBeArray, zeroPadValue, JsonRpcProvider } from 'ethers'
import { ChainId, ERC721TradeAsset, TradeAsset, TradeAssetType, TradeCreation } from '@dcl/schemas'
import { ContractData, ContractName, getContract } from 'decentraland-transactions'
import { InvalidECDSASignatureError, MarketplaceContractNotFound } from '../../ports/trades/errors'
import { fromMillisecondsToSeconds } from '../date'
import { hasECDSASignatureAValidV } from '../signatures'

function getRPCUrlByChainId(chainId: ChainId): string {
  let rpcPath: string
  switch (chainId) {
    case ChainId.ETHEREUM_MAINNET:
      rpcPath = 'mainnet'
      break
    case ChainId.ETHEREUM_SEPOLIA:
      rpcPath = 'sepolia'
      break
    case ChainId.MATIC_MAINNET:
      rpcPath = 'polygon'
      break
    case ChainId.MATIC_AMOY:
      rpcPath = 'amoy'
      break
    default:
      throw new Error('Unsupported chainId')
  }
  return `https://rpc.decentraland.org/${rpcPath}`
}

// Reuse one provider per chain instead of constructing a new JsonRpcProvider (and re-running
// network detection) on every ownership / fingerprint check on the trade-creation hot path.
const providersByChainId: Partial<Record<ChainId, JsonRpcProvider>> = {}

function getProvider(chainId: ChainId): JsonRpcProvider {
  let provider = providersByChainId[chainId]
  if (!provider) {
    provider = new JsonRpcProvider(getRPCUrlByChainId(chainId))
    providersByChainId[chainId] = provider
  }
  return provider
}

// Bound on-chain reads so a slow/unresponsive public RPC can't stall trade creation up to the
// DB statement timeout (40s). Callers treat a timeout as a validation failure.
export const ON_CHAIN_READ_TIMEOUT_MS = 5000

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
  }
}

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
    { name: 'value', type: 'bytes' },
    { name: 'required', type: 'bool' }
  ]
}

export function validateTradeSignature(trade: TradeCreation, signer: string): boolean {
  if (!hasECDSASignatureAValidV(trade.signature)) {
    throw new InvalidECDSASignatureError()
  }

  let offChainMarketplaceContract: ContractData
  try {
    offChainMarketplaceContract = getContract(ContractName.OffChainMarketplaceV2, trade.chainId)
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
        // '0x' is the default value for the value bytes (0 bytes)
        value: externalCheck.value ? externalCheck.value : '0x',
        required: externalCheck.required
      }))
    },
    sent: trade.sent.map(asset => ({
      assetType: asset.assetType,
      contractAddress: asset.contractAddress,
      value: getValueFromTradeAsset(asset),
      // '0x' is the default value for extra bytes (0 bytes)
      extra: asset.extra ? asset.extra : '0x'
    })),
    received: trade.received.map(asset => ({
      assetType: asset.assetType,
      contractAddress: asset.contractAddress,
      value: getValueFromTradeAsset(asset),
      // '0x' is the default value for extra bytes (0 bytes)
      extra: asset.extra ? asset.extra : '0x',
      beneficiary: asset.beneficiary
    }))
  }

  return verifyTypedData(domain, MARKETPLACE_TRADE_TYPES, values, trade.signature).toLowerCase() === signer
}

export function isERC721TradeAsset(asset: TradeAsset): asset is ERC721TradeAsset {
  return (asset as ERC721TradeAsset).tokenId !== undefined
}

async function getContractOwner(contractAddress: string, tokenId: string, chainId: ChainId): Promise<string> {
  const abi = ['function ownerOf(uint256 tokenId) view returns (address)']
  const contract = new Contract(contractAddress, abi, getProvider(chainId))
  return await withTimeout(
    contract.ownerOf(tokenId),
    ON_CHAIN_READ_TIMEOUT_MS,
    `Timed out reading ownerOf for ${contractAddress}:${tokenId}`
  )
}

export async function isEstateFingerprintValid(
  contractAddress: string,
  tokenId: string,
  chainId: ChainId,
  fingerprint: string
): Promise<boolean> {
  const abi = ['function getFingerprintV2(uint256 tokenId) view returns (bytes32)']
  const contract = new Contract(contractAddress, abi, getProvider(chainId))
  const estateFingerprint = await withTimeout(
    contract.getFingerprintV2(tokenId),
    ON_CHAIN_READ_TIMEOUT_MS,
    `Timed out reading getFingerprintV2 for ${contractAddress}:${tokenId}`
  )
  return estateFingerprint.toLowerCase() === fingerprint.toLowerCase()
}

export async function validateAssetOwnership(asset: ERC721TradeAsset, signer: string, chainId: ChainId): Promise<boolean> {
  const { contractAddress, tokenId } = asset
  const blockchainOwner = await getContractOwner(contractAddress, tokenId, chainId)
  return blockchainOwner.toLowerCase() === signer.toLowerCase()
}
