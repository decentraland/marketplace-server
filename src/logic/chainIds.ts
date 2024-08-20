import { ChainId, Network } from '@dcl/schemas'
import { SquidNetwork } from '../types'

export const getPolygonChainId = () => parseInt(process.env.POLYGON_CHAIN_ID || ChainId.MATIC_MAINNET.toString()) as ChainId

export const getEthereumChainId = () => parseInt(process.env.ETHEREUM_CHAIN_ID || ChainId.ETHEREUM_MAINNET.toString()) as ChainId

export const getNetworkChainId = (network: Network | SquidNetwork) => {
  if (network === SquidNetwork.POLYGON || network === Network.MATIC) {
    return getPolygonChainId()
  } else {
    return getEthereumChainId()
  }
}

export const getNetwork = (network: Network.ETHEREUM | Network.MATIC | SquidNetwork): Network.ETHEREUM | Network.MATIC => {
  if (network === SquidNetwork.POLYGON || network === Network.MATIC) {
    return Network.MATIC
  }
  return Network.ETHEREUM
}
