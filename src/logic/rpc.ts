import { ChainId } from '@dcl/schemas'

const RPC_BASE_URL = 'https://rpc.decentraland.org'

/** Resolves the DCL RPC URL for a supported chain id. */
export function getRpcUrlByChainId(chainId: ChainId): string {
  switch (chainId) {
    case ChainId.ETHEREUM_MAINNET:
      return `${RPC_BASE_URL}/mainnet`
    case ChainId.ETHEREUM_SEPOLIA:
      return `${RPC_BASE_URL}/sepolia`
    case ChainId.MATIC_MAINNET:
      return `${RPC_BASE_URL}/polygon`
    case ChainId.MATIC_AMOY:
      return `${RPC_BASE_URL}/amoy`
    default:
      throw new Error(`Unsupported chainId ${chainId}`)
  }
}
