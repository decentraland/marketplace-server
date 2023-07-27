// This file is the "test-environment" analogous for src/components.ts
// Here we define the test components to be used in the testing environment

import { IPgComponent } from '@well-known-components/pg-component'
import { createRunner, createLocalFetchCompoment } from '@well-known-components/test-helpers'
import { initComponents as originalInitComponents } from '../src/components'
import { main } from '../src/service'
import { TestComponents } from '../src/types'

/**
 * Behaves like Jest "describe" function, used to describe a test for a
 * use case, it creates a whole new program and components to run an
 * isolated test.
 *
 * State is persistent within the steps of the test.
 */
export const test = createRunner<TestComponents>({
  main,
  initComponents
})

async function initComponents(): Promise<TestComponents> {
  const components = await originalInitComponents()

  const { config, database } = components

  // Mock the start function to avoid connecting to a local database
  jest.spyOn(database, 'start').mockResolvedValue(undefined)

  return {
    ...components,
    localFetch: await createLocalFetchCompoment(config)
  }
}

export function createTestDbComponent(
  { query = jest.fn(), start = jest.fn(), streamQuery = jest.fn(), getPool = jest.fn(), stop = jest.fn() } = {
    query: jest.fn(),
    start: jest.fn(),
    streamQuery: jest.fn(),
    getPool: jest.fn(),
    stop: jest.fn()
  }
): IPgComponent {
  return {
    start,
    streamQuery,
    query,
    getPool,
    stop
  }
}
