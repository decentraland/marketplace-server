import { isAddress, isAddressZero } from '../../src/logic/address'

describe('isAddress', () => {
  it('should return true for valid addresses', () => {
    expect(isAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')).toBe(true)
    expect(isAddress('0xFd25A2A94f4213A6cA2A0a257b65cCcB032C6614')).toBe(true)
  })

  it('should return false for invalid addresses', () => {
    expect(isAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAe')).toBe(false) // Address with length 39
    expect(isAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeDG')).toBe(false) // Non-hexadecimal character 'D'
    expect(isAddress(null)).toBe(false)
    expect(isAddress(undefined)).toBe(false)
    expect(isAddress('')).toBe(false)
  })
})

describe('isAddressZero', () => {
  it('should return true for address with all zeros', () => {
    expect(isAddressZero('0x0000000000000000000000000000000000000000')).toBe(true)
  })

  it('should return false for non-zero addresses', () => {
    expect(isAddressZero('0x0000000000000000000000000000000000000001')).toBe(false)
    expect(isAddressZero('0x1000000000000000000000000000000000000000')).toBe(false)
    expect(isAddressZero('0x')).toBe(false) // Empty address
  })
})
