import { IContractStatusComponent, PausedContract } from '../../src/ports/contract-status/types'

export function createContractStatusMockedComponent(pausedContracts: PausedContract[] = []): jest.Mocked<IContractStatusComponent> {
  return {
    getPausedContracts: jest.fn().mockReturnValue(pausedContracts),
    isPaused: jest
      .fn()
      .mockImplementation((address: string, network: string) =>
        pausedContracts.some(paused => paused.address === address.toLowerCase() && paused.network === network)
      ),
    refresh: jest.fn().mockResolvedValue(undefined)
  }
}
