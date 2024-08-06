import { Event } from '@dcl/schemas'

export type IEventPublisherComponent = {
  publishMessage(event: Event): Promise<string | undefined>
}
