/* eslint-disable @typescript-eslint/naming-convention */
import {
  Contract,
  TypedDataField,
  TypedDataDomain,
  TypedDataEncoder,
  verifyTypedData,
  toBeArray,
  zeroPadValue,
  JsonRpcProvider
} from 'ethers'
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

export function getValueFromTradeAsset(asset: TradeAsset) {
  switch (asset.assetType) {
    case TradeAssetType.COLLECTION_ITEM:
      return asset.itemId
    case TradeAssetType.ERC20:
    case TradeAssetType.USD_PEGGED_MANA:
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

/**
 * Off-chain marketplace versions a trade can be signed against, newest first.
 *
 * The EIP-712 domain names its verifying contract, so the marketplace version is part of what the
 * signer signed: one trade signed against V2 and against V3 produces different digests and different
 * signatures. Pinning a single version would therefore reject every trade signed against the other one
 * for as long as clients are mid-rollout, so resolution tries each deployed version and keeps whichever
 * the signature actually verifies against. Newest first, so new trades settle on the newest deployment.
 */
export const OFF_CHAIN_MARKETPLACE_CONTRACT_NAMES = [ContractName.OffChainMarketplaceV3, ContractName.OffChainMarketplaceV2]

/**
 * Versions that identify a trade by its EIP-712 digest rather than by keccak256 of the signature bytes.
 *
 * This is what a cancellation is keyed on, so it decides which value has to be stored to be able to
 * correlate a SignatureCancelled event back to its trade. V1 and V2 key on the signature hash, which the
 * trade already stores as `hashed_signature`; V3 keys on the digest, which nothing else records.
 */
const DIGEST_KEYED_MARKETPLACE_CONTRACT_NAMES: ContractName[] = [ContractName.OffChainMarketplaceV3]

/**
 * Every off-chain marketplace version, oldest first, for enumerating addresses the indexer may hold rows
 * for. Distinct from OFF_CHAIN_MARKETPLACE_CONTRACT_NAMES, which lists only the versions a NEW trade may
 * be signed against.
 */
const ALL_OFF_CHAIN_MARKETPLACE_CONTRACT_NAMES = [
  ContractName.OffChainMarketplace,
  ContractName.OffChainMarketplaceV2,
  ContractName.OffChainMarketplaceV3
]

/**
 * Addresses of every off-chain marketplace version deployed on a chain, lowercased.
 *
 * Lowercased because every SQL comparison against these is written as `LOWER(address) IN (...)`, and some
 * entries in the contract registry are checksummed — a checksummed literal on the right-hand side of that
 * comparison can never match.
 */
export function getOffChainMarketplaceAddresses(chainId: ChainId): string[] {
  return ALL_OFF_CHAIN_MARKETPLACE_CONTRACT_NAMES.reduce<string[]>((addresses, contractName) => {
    try {
      addresses.push(getContract(contractName, chainId).address.toLowerCase())
    } catch (e) {
      // Version not deployed on this chain.
    }
    return addresses
  }, [])
}

/** The marketplace versions deployed on a chain, newest first. Empty if none are. */
export function getOffChainMarketplaceContracts(chainId: ChainId): { contractName: ContractName; contract: ContractData }[] {
  return OFF_CHAIN_MARKETPLACE_CONTRACT_NAMES.reduce<{ contractName: ContractName; contract: ContractData }[]>(
    (contracts, contractName) => {
      try {
        contracts.push({ contractName, contract: getContract(contractName, chainId) })
      } catch (e) {
        // Not every version exists on every chain — V3 is testnet-only for now, so getContract throws
        // for it on mainnet. A version that is not deployed is simply not a candidate.
      }
      return contracts
    },
    []
  )
}

function getTradeTypedData(trade: TradeCreation, contract: ContractData): { domain: TypedDataDomain; values: Record<string, unknown> } {
  const SALT = zeroPadValue(toBeArray(trade.chainId), 32)
  const domain: TypedDataDomain = {
    name: contract.name,
    version: contract.version,
    salt: SALT,
    verifyingContract: contract.address
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

  return { domain, values }
}

export type TradeSignatureMatch = {
  /** The marketplace version the signature verified against. */
  contract: ContractData
  /**
   * The identifier the matched marketplace keys cancellations on, or null when it keys them on
   * keccak256(signature bytes) — which the trade already stores as `hashed_signature`.
   *
   * Deliberately null rather than "the digest of whichever version matched": the indexer only records a
   * digest for the versions that use one, so storing a digest for a V2 trade would leave the two columns
   * meaning different things on each side of the join.
   */
  cancellationDigest: string | null
}

/**
 * Verifies the signature and reports which marketplace version produced it, plus that version's digest.
 * Returns null when no deployed version verifies, i.e. the signature does not belong to this signer.
 */
export function resolveTradeSignature(trade: TradeCreation, signer: string): TradeSignatureMatch | null {
  if (!hasECDSASignatureAValidV(trade.signature)) {
    throw new InvalidECDSASignatureError()
  }

  const contracts = getOffChainMarketplaceContracts(trade.chainId)
  if (!contracts.length) {
    throw new MarketplaceContractNotFound(trade.chainId, trade.network)
  }

  for (const { contractName, contract } of contracts) {
    const { domain, values } = getTradeTypedData(trade, contract)
    if (verifyTypedData(domain, MARKETPLACE_TRADE_TYPES, values, trade.signature).toLowerCase() === signer) {
      return {
        contract,
        cancellationDigest: DIGEST_KEYED_MARKETPLACE_CONTRACT_NAMES.includes(contractName)
          ? TypedDataEncoder.hash(domain, MARKETPLACE_TRADE_TYPES, values)
          : null
      }
    }
  }

  return null
}

export function validateTradeSignature(trade: TradeCreation, signer: string): boolean {
  return resolveTradeSignature(trade, signer) !== null
}

export function isERC721TradeAsset(asset: TradeAsset): asset is ERC721TradeAsset {
  return (asset as ERC721TradeAsset).tokenId !== undefined
}

async function getContractOwner(contractAddress: string, tokenId: string, chainId: ChainId): Promise<string> {
  const abi = ['function ownerOf(uint256 tokenId) view returns (address)']
  const provider = new JsonRpcProvider(getRPCUrlByChainId(chainId))
  const contract = new Contract(contractAddress, abi, provider)
  return await contract.ownerOf(tokenId)
}

export async function isEstateFingerprintValid(
  contractAddress: string,
  tokenId: string,
  chainId: ChainId,
  fingerprint: string
): Promise<boolean> {
  const abi = ['function getFingerprintV2(uint256 tokenId) view returns (bytes32)']
  const provider = new JsonRpcProvider(getRPCUrlByChainId(chainId))
  const contract = new Contract(contractAddress, abi, provider)
  const estateFingerprint = await contract.getFingerprintV2(tokenId)
  return estateFingerprint.toLowerCase() === fingerprint.toLowerCase()
}

export async function validateAssetOwnership(asset: ERC721TradeAsset, signer: string, chainId: ChainId): Promise<boolean> {
  const { contractAddress, tokenId } = asset
  const blockchainOwner = await getContractOwner(contractAddress, tokenId, chainId)
  return blockchainOwner.toLowerCase() === signer.toLowerCase()
}
