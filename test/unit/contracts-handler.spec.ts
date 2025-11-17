/* eslint-disable @typescript-eslint/unbound-method */
import { URL } from 'url'
import { ChainId, Contract, Network, NFTCategory } from '@dcl/schemas'
import { getContractsHandler } from '../../src/controllers/handlers/contracts-handler'
import { ContractSortBy } from '../../src/ports/contracts/types'
import { HandlerContextWithPath, StatusCode } from '../../src/types'

let contracts: Contract[]

describe('when fetching contracts', () => {
  let context: Pick<HandlerContextWithPath<'contracts', '/v1/contracts'>, 'components' | 'url' | 'verification'>

  beforeEach(() => {
    contracts = [
      {
        name: 'Test Collection',
        address: '0x1096f950841a99f9b961434714d9a08d3d4ebdff',
        category: NFTCategory.WEARABLE,
        network: Network.MATIC,
        chainId: ChainId.MATIC_AMOY
      }
    ]

    context = {
      url: new URL('http://localhost:3000/v1/contracts'),
      components: {
        contracts: {
          getContracts: jest.fn().mockResolvedValue({ data: contracts, total: 1 }),
          getMarketplaceContracts: jest.fn().mockReturnValue([]),
          getCollectionContracts: jest.fn().mockResolvedValue({ data: [], total: 0 }),
          getAllCollectionContracts: jest.fn().mockResolvedValue([])
        }
      },
      verification: {
        auth: 'TOKEN',
        authMetadata: {}
      }
    }
  })

  describe('and the first parameter is defined in the url', () => {
    beforeEach(() => {
      context.url = new URL('http://localhost:3000/v1/contracts?first=10')
    })

    it('should fetch contracts with the correct first value', async () => {
      const result = await getContractsHandler(context)

      expect(context.components.contracts.getContracts).toHaveBeenCalledWith(expect.objectContaining({ first: 10 }))
      expect(result).toEqual({
        status: StatusCode.OK,
        body: {
          data: contracts,
          total: 1
        }
      })
    })
  })

  describe('and the skip parameter is defined in the url', () => {
    beforeEach(() => {
      context.url = new URL('http://localhost:3000/v1/contracts?skip=5')
    })

    it('should fetch contracts with the correct skip value', async () => {
      const result = await getContractsHandler(context)

      expect(context.components.contracts.getContracts).toHaveBeenCalledWith(expect.objectContaining({ skip: 5 }))
      expect(result).toEqual({
        status: StatusCode.OK,
        body: {
          data: contracts,
          total: 1
        }
      })
    })
  })

  describe('and neither first nor skip parameters are defined in the url', () => {
    beforeEach(() => {
      context.url = new URL('http://localhost:3000/v1/contracts')
    })

    it('should fetch contracts with undefined first and skip values', async () => {
      const result = await getContractsHandler(context)

      expect(context.components.contracts.getContracts).toHaveBeenCalledWith(expect.objectContaining({ first: undefined, skip: undefined }))
      expect(result).toEqual({
        status: StatusCode.OK,
        body: {
          data: contracts,
          total: 1
        }
      })
    })
  })

  describe('and the sortBy parameter is defined in the url', () => {
    beforeEach(() => {
      context.url = new URL('http://localhost:3000/v1/contracts?sortBy=name')
    })

    it('should fetch contracts with the correct sortBy', async () => {
      const result = await getContractsHandler(context)

      expect(context.components.contracts.getContracts).toHaveBeenCalledWith(expect.objectContaining({ sortBy: ContractSortBy.NAME }))
      expect(result).toEqual({
        status: StatusCode.OK,
        body: {
          data: contracts,
          total: 1
        }
      })
    })
  })

  describe('and the category parameter is defined in the url', () => {
    beforeEach(() => {
      context.url = new URL(`http://localhost:3000/v1/contracts?category=${NFTCategory.WEARABLE}`)
    })

    it('should fetch contracts with the correct category', async () => {
      const result = await getContractsHandler(context)

      expect(context.components.contracts.getContracts).toHaveBeenCalledWith(expect.objectContaining({ category: NFTCategory.WEARABLE }))
      expect(result).toEqual({
        status: StatusCode.OK,
        body: {
          data: contracts,
          total: 1
        }
      })
    })
  })

  describe('and the network parameter is defined in the url', () => {
    beforeEach(() => {
      context.url = new URL(`http://localhost:3000/v1/contracts?network=${Network.MATIC}`)
    })

    it('should fetch contracts with the correct network', async () => {
      const result = await getContractsHandler(context)

      expect(context.components.contracts.getContracts).toHaveBeenCalledWith(expect.objectContaining({ network: Network.MATIC }))
      expect(result).toEqual({
        status: StatusCode.OK,
        body: {
          data: contracts,
          total: 1
        }
      })
    })
  })

  describe('and there is an error fetching contracts', () => {
    let error: Error

    beforeEach(() => {
      context.url = new URL('http://localhost:3000/v1/contracts')
      error = new Error('Failed to fetch contracts')
      context.components.contracts.getContracts = jest.fn().mockRejectedValue(error)
    })

    it('should return response with status BAD_REQUEST', async () => {
      const result = await getContractsHandler(context)

      expect(result).toEqual({
        status: StatusCode.BAD_REQUEST,
        body: {
          ok: false,
          message: error.message
        }
      })
    })
  })
})
