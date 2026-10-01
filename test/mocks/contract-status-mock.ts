import { IContractStatusComponent, PausedContract } from '../../src/ports/contract-status/types'

export function createContractStatusMockedComponent(pausedContracts: PausedContract[] = []): jest.Mocked<IContractStatusComponent> {
  return {
    getPausedContracts: jest.fn().mockReturnValue(pausedContracts),
    refresh: jest.fn().mockResolvedValue(undefined)
  }
}
