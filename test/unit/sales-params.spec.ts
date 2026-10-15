import { getSalesParams } from '../../src/controllers/handlers/utils'
import { Params } from '../../src/logic/http/params'

function parse(query: string) {
  return getSalesParams(new Params(new URLSearchParams(query)))
}

describe('when parsing the sales feed parameters', () => {
  describe('and a creator is given', () => {
    it('should lowercase it and keep the seller apart', () => {
      expect(parse('creator=0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&seller=0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')).toMatchObject({
        creator: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        seller: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
      })
    })
  })

  describe('and the creator is not an address', () => {
    it.each(['creator=', 'creator=invalid', 'creator=0x123'])('should throw for %s', query => {
      expect(() => parse(query)).toThrow('creator must be an address')
    })
  })

  describe('and no creator is given', () => {
    it('should leave it undefined', () => {
      expect(parse('seller=0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb').creator).toBeUndefined()
    })
  })
})
