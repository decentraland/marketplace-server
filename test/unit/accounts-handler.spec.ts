/* eslint-disable @typescript-eslint/unbound-method */
import { URL } from 'url'
import { Network } from '@dcl/schemas'
import { getAccountsHandler } from '../../src/controllers/handlers/accounts-handler'
import { Account, AccountSortBy } from '../../src/ports/accounts/types'
import { HandlerContextWithPath, StatusCode } from '../../src/types'

let accounts: Account[]

describe('when fetching accounts', () => {
  let context: Pick<HandlerContextWithPath<'accounts', '/v1/accounts'>, 'components' | 'url' | 'verification'>

  beforeEach(() => {
    accounts = [
      {
        id: '0x1-polygon',
        address: '0x1',
        sales: 10,
        purchases: 5,
        spent: '1000000000000000000',
        earned: '2000000000000000000',
        royalties: '500000000000000000',
        collections: 3
      }
    ]

    context = {
      url: new URL('http://localhost:3000/v1/accounts'),
      components: {
        accounts: {
          getAccounts: jest.fn().mockResolvedValue({ data: accounts, total: 1 })
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
      context.url = new URL('http://localhost:3000/v1/accounts?first=10')
    })

    it('should fetch accounts with the correct first value', async () => {
      const result = await getAccountsHandler(context)

      expect(context.components.accounts.getAccounts).toHaveBeenCalledWith(expect.objectContaining({ first: 10 }))
      expect(result).toEqual({
        status: StatusCode.OK,
        body: {
          data: accounts,
          total: 1
        }
      })
    })
  })

  describe('and the skip parameter is defined in the url', () => {
    beforeEach(() => {
      context.url = new URL('http://localhost:3000/v1/accounts?skip=5')
    })

    it('should fetch accounts with the correct skip value', async () => {
      const result = await getAccountsHandler(context)

      expect(context.components.accounts.getAccounts).toHaveBeenCalledWith(expect.objectContaining({ skip: 5 }))
      expect(result).toEqual({
        status: StatusCode.OK,
        body: {
          data: accounts,
          total: 1
        }
      })
    })
  })

  describe('and neither first nor skip parameters are defined in the url', () => {
    beforeEach(() => {
      context.url = new URL('http://localhost:3000/v1/accounts')
    })

    it('should fetch accounts with undefined first and skip values', async () => {
      const result = await getAccountsHandler(context)

      expect(context.components.accounts.getAccounts).toHaveBeenCalledWith(expect.objectContaining({ first: undefined, skip: undefined }))
      expect(result).toEqual({
        status: StatusCode.OK,
        body: {
          data: accounts,
          total: 1
        }
      })
    })
  })

  describe('and the sortBy parameter is defined in the url', () => {
    describe('and the sortBy value is valid', () => {
      beforeEach(() => {
        context.url = new URL('http://localhost:3000/v1/accounts?sortBy=most_sales')
      })

      it('should fetch accounts with the correct sortBy', async () => {
        const result = await getAccountsHandler(context)

        expect(context.components.accounts.getAccounts).toHaveBeenCalledWith(expect.objectContaining({ sortBy: AccountSortBy.MOST_SALES }))
        expect(result).toEqual({
          status: StatusCode.OK,
          body: {
            data: accounts,
            total: 1
          }
        })
      })
    })
  })

  describe('and the id parameter is defined in the url', () => {
    beforeEach(() => {
      context.url = new URL('http://localhost:3000/v1/accounts?id=0x1-polygon')
    })

    it('should fetch accounts with the correct id', async () => {
      const result = await getAccountsHandler(context)

      expect(context.components.accounts.getAccounts).toHaveBeenCalledWith(expect.objectContaining({ id: '0x1-polygon' }))
      expect(result).toEqual({
        status: StatusCode.OK,
        body: {
          data: accounts,
          total: 1
        }
      })
    })
  })

  describe('and the address parameter is defined in the url', () => {
    beforeEach(() => {
      context.url = new URL('http://localhost:3000/v1/accounts?address=0x1&address=0x2')
    })

    it('should fetch accounts with the correct addresses', async () => {
      const result = await getAccountsHandler(context)

      expect(context.components.accounts.getAccounts).toHaveBeenCalledWith(expect.objectContaining({ address: ['0x1', '0x2'] }))
      expect(result).toEqual({
        status: StatusCode.OK,
        body: {
          data: accounts,
          total: 1
        }
      })
    })
  })

  describe('and the network parameter is defined in the url', () => {
    describe('and the network is valid', () => {
      beforeEach(() => {
        context.url = new URL(`http://localhost:3000/v1/accounts?network=${Network.MATIC}`)
      })

      it('should fetch accounts with the correct network', async () => {
        const result = await getAccountsHandler(context)

        expect(context.components.accounts.getAccounts).toHaveBeenCalledWith(expect.objectContaining({ network: Network.MATIC }))
        expect(result).toEqual({
          status: StatusCode.OK,
          body: {
            data: accounts,
            total: 1
          }
        })
      })
    })
  })

  describe('and there is an error fetching accounts', () => {
    let error: Error

    beforeEach(() => {
      context.url = new URL('http://localhost:3000/v1/accounts')
      error = new Error('Failed to fetch accounts')
      context.components.accounts.getAccounts = jest.fn().mockRejectedValue(error)
    })

    it('should return response with status BAD_REQUEST', async () => {
      const result = await getAccountsHandler(context)

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
