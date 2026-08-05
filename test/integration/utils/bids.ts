import { Authenticator } from '@dcl/crypto'
import { ChainId, Network, TradeAssetType, TradeCreation, TradeType } from '@dcl/schemas'
import { ContractName, getContract } from 'decentraland-transactions'
import { TestComponents } from '../../../src/types'
import { getSignedFetchRequest } from '../../utils'

export type CreateBidViaAPIOptions = {
  contractAddress: string
  price: string
  network?: Network
} & ({ tokenId: string } | { itemId: string })

export type CreateBidViaAPIResult = {
  tradeId: string
  signer: string
}

export async function createBidViaAPI(
  components: Pick<TestComponents, 'localFetch'>,
  options: CreateBidViaAPIOptions
): Promise<CreateBidViaAPIResult> {
  const { localFetch } = components
  const { contractAddress, price, network = Network.ETHEREUM } = options

  const signedRequest = await getSignedFetchRequest('POST', '/v1/trades', {
    intent: 'dcl:create-trade',
    signer: 'dcl:marketplace'
  })
  const signer = signedRequest.identity.realAccount.address.toLowerCase()

  const received =
    'tokenId' in options
      ? [
          {
            assetType: TradeAssetType.ERC721 as const,
            contractAddress,
            tokenId: options.tokenId,
            extra: '0x',
            beneficiary: contractAddress
          }
        ]
      : [
          {
            assetType: TradeAssetType.COLLECTION_ITEM as const,
            contractAddress,
            itemId: options.itemId,
            extra: '0x',
            beneficiary: contractAddress
          }
        ]

  const bid: TradeCreation = {
    signature: Authenticator.createSignature(signedRequest.identity.realAccount, Math.random().toString()),
    signer,
    chainId: 1,
    type: TradeType.BID,
    checks: {
      effective: Date.now(),
      expiration: Date.now() + 1000000,
      allowedRoot: '0x',
      contractSignatureIndex: 0,
      signerSignatureIndex: 0,
      externalChecks: [],
      salt: '0x',
      uses: 1
    },
    network,
    sent: [
      {
        assetType: TradeAssetType.ERC20,
        contractAddress: getContract(ContractName.MANAToken, ChainId.ETHEREUM_MAINNET).address,
        extra: '0x',
        amount: price
      }
    ],
    received
  }

  const response = await localFetch.fetch('/v1/trades', {
    method: signedRequest.method,
    body: JSON.stringify(bid),
    headers: { ...signedRequest.headers, 'Content-Type': 'application/json' }
  })
  const body = await response.json()

  return {
    tradeId: body.data.id,
    signer
  }
}
