import { ITracerComponent } from '@well-known-components/interfaces'
import { IFetchComponent } from '@dcl/core-commons'
import { createTracedFetcherComponent } from '@dcl/traced-fetch-component'

export async function createFetchComponent(components: { tracer: ITracerComponent }): Promise<IFetchComponent> {
  const { tracer } = components
  return createTracedFetcherComponent({ tracer })
}
