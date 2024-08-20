/* eslint-disable @typescript-eslint/naming-convention */
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns'
import { Event } from '@dcl/schemas'
import { AppComponents } from '../../types'
import { IEventPublisherComponent } from './types'

export async function createEventPublisher({ config }: Pick<AppComponents, 'config'>): Promise<IEventPublisherComponent> {
  const snsArn = await config.requireString('AWS_SNS_ARN')
  const optionalEndpoint = await config.getString('AWS_SNS_ENDPOINT')

  const client = new SNSClient({
    endpoint: optionalEndpoint
  })

  async function publishMessage(event: Event): Promise<string | undefined> {
    const { MessageId } = await client.send(
      new PublishCommand({
        TopicArn: snsArn,
        Message: JSON.stringify(event),
        MessageAttributes: {
          type: {
            DataType: 'String',
            StringValue: event.type
          },
          subType: {
            DataType: 'String',
            StringValue: event.subType
          }
        }
      })
    )

    return MessageId
  }

  return { publishMessage }
}
