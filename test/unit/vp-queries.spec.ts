import { insertVPQuery } from '../../src/ports/favorites/vp/queries'

let userAddress: string

beforeEach(() => {
  userAddress = 'user-address'
})

describe('when getting the insert VP query', () => {
  describe('and the power query is rejected', () => {
    it('should return a query to try to set the VP to 0 without overwriting it if it already exists', () => {
      const query = insertVPQuery(undefined, userAddress)

      expect(query.text).toContain('VALUES ($1, $2) ON CONFLICT (user_address) DO NOTHING')
      expect(query.values).toEqual(expect.arrayContaining([userAddress, 0]))
    })
  })

  describe('and the power query succeeds', () => {
    describe.each([0, 100])('and the VP got from snapshot is %d', (power: number) => {
      it('should return a query to try to set the VP to the value returned by the query and updating it if already exists', () => {
        const query = insertVPQuery(power, userAddress)

        expect(query.text).toContain('VALUES ($1, $2) ON CONFLICT (user_address) DO UPDATE SET power = $3')
        expect(query.values).toEqual(expect.arrayContaining([userAddress, power, power]))
      })
    })
  })
})
