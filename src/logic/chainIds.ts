import { ChainId } from '@dcl/schemas'

export const getPolygonChainId = () => parseInt(process.env.POLYGON_CHAIN_ID || ChainId.MATIC_MAINNET.toString()) as ChainId

export const getEthereumChainId = () => parseInt(process.env.ETHEREUM_CHAIN_ID || ChainId.ETHEREUM_MAINNET.toString()) as ChainId
