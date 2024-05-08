import { isEthereumAddressValid } from '../../src/logic/ethereum/validations'

describe('when checking if an ethereum address is valid', () => {
  let address: string

  describe('and the address is greater in size than 42 characters', () => {
    beforeEach(() => {
      address = '0xaAE21F9ce1eE6D6259aCB85D350264e059C74A010000000000'
    })

    it('should return false', () => {
      expect(isEthereumAddressValid(address)).toBe(false)
    })
  })

  describe('and the address is lower in size than 42 characters', () => {
    beforeEach(() => {
      address = '0xaAE21F9ce1eE6D6259aCB85D350264e'
    })

    it('should return false', () => {
      expect(isEthereumAddressValid(address)).toBe(false)
    })
  })

  describe('and the address does not start with 0x', () => {
    beforeEach(() => {
      address = 'aAE21F9ce1eE6D6259aCB85D350264e059C74A01'
    })

    it('should return false', () => {
      expect(isEthereumAddressValid(address)).toBe(false)
    })
  })

  describe('and the address contains a non hex character', () => {
    beforeEach(() => {
      address = '0xaAEZ1F9ce1eE6D6259aCB85D350264e059C74A010000000000'
    })

    it('should return false', () => {
      expect(isEthereumAddressValid(address)).toBe(false)
    })
  })

  describe('and the address is valid', () => {
    beforeEach(() => {
      address = '0xaAE21F9ce1eE6D6259aCB85D350264e059C74A01'
    })

    it('should return true', () => {
      expect(isEthereumAddressValid(address)).toBe(true)
    })
  })
})
