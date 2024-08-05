/* eslint-disable @typescript-eslint/naming-convention */
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns'
import { createConfigComponent } from '@well-known-components/env-config-provider'
import { IConfigComponent } from '@well-known-components/interfaces'
import { Events, NFTCategory, Rarity, Network, Event } from '@dcl/schemas'
import { IEventPublisherComponent, createEventPublisher } from '../../src/ports/events'

let configComponent: IConfigComponent
let eventPublisherComponent: IEventPublisherComponent

jest.mock('@aws-sdk/client-sns', () => {
  return {
    SNSClient: jest.fn(() => ({
      send: jest.fn() // Mock the send method
    })),
    PublishCommand: jest.fn((config: unknown) => ({ config }))
  }
})

describe('when publishing a message', () => {
  let sendMock: jest.Mock
  let result: string | undefined
  let messageId: string
  let event: Event

  beforeEach(async () => {
    messageId = 'message-id'
    sendMock = jest.fn().mockResolvedValue({ MessageId: messageId })
    ;(SNSClient as jest.Mock).mockImplementation(() => ({ send: sendMock }))
    configComponent = createConfigComponent({}, { AWS_SNS_ARN: 'test-arn', AWS_SNS_ENDPOINT: 'test-endpoint' })
    eventPublisherComponent = await createEventPublisher({ config: configComponent })
    event = {
      type: Events.Type.MARKETPLACE,
      subType: Events.SubType.Marketplace.BID_RECEIVED,
      key: 'bid-created-1',
      timestamp: Date.now(),
      metadata: {
        address: '0x123',
        image: 'image.png',
        seller: '0x123',
        category: NFTCategory.EMOTE,
        rarity: Rarity.RARE,
        link: '/account?section=bids',
        nftName: 'my name',
        price: '123123123',
        title: 'Bid Received',
        description: 'You received a bid of 1 MANA for this my name.',
        network: Network.ARBITRUM
      }
    }

    result = await eventPublisherComponent.publishMessage(event)
  })

  it('should return message id', () => {
    expect(result).toBe(messageId)
  })

  it('should call send function with correct info', () => {
    expect(sendMock).toHaveBeenCalledWith(new PublishCommand({ TopicArn: 'test-arn', Message: JSON.stringify(event) }))
  })
})
