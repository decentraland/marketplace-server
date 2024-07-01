import { TradeType } from '@dcl/schemas'
import { fromDbTradeWithAssetsToTrade } from '../../src/adapters/trades/trades'
import { DBTradeAsset } from '../../src/ports/trades'

describe('fromDbTradeWithAssetsToTrade', () => {
  it('should convert DBTrade with assets to Trade', () => {
    const dbTrade = {
      id: '123',
      signature: '123123123',
      signer: '0x1234567890',
      type: TradeType.BID,
      network: 'ETHEREUM',
      effective_since: new Date(),
      expires_at: new Date(),
      chain_id: 1,
      checks: ['check1', 'check2'],
      created_at: new Date()
    }

    const dbSentAsset: DBTradeAsset = {
      id: 'asset-1',
      asset_type: 1,
      contract_address: '0xabcdef',
      value: '1',
      extra: '',
      direction: 'sent',
      trade_id: dbTrade.id,
      created_at: new Date()
    }

    const dbReceivedAsset: DBTradeAsset = {
      id: 'asset-2',
      asset_type: 2,
      contract_address: '0x789abc',
      value: '3',
      extra: '',
      direction: 'received',
      beneficiary: '0x9876543210',
      trade_id: dbTrade.id,
      created_at: new Date()
    }

    const result = fromDbTradeWithAssetsToTrade(dbTrade, [dbSentAsset], [dbReceivedAsset])

    expect(result).toEqual({
      id: dbTrade.id,
      signer: dbTrade.signer,
      type: dbTrade.type,
      network: dbTrade.network,
      chainId: dbTrade.chain_id,
      checks: dbTrade.checks,
      createdAt: dbTrade.created_at.getTime(),
      sent: [
        {
          assetType: dbSentAsset.asset_type,
          contractAddress: dbSentAsset.contract_address,
          value: dbSentAsset.value,
          extra: dbSentAsset.extra
        }
      ],
      received: [
        {
          assetType: dbReceivedAsset.asset_type,
          contractAddress: dbReceivedAsset.contract_address,
          value: dbReceivedAsset.value,
          extra: dbReceivedAsset.extra,
          beneficiary: dbReceivedAsset.beneficiary
        }
      ]
    })
  })
})
