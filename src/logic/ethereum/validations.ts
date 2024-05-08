const ethAddressRegex = /^0x[a-fA-F0-9]{40}$/

/**
 * Check if an ethereum address is validated correctly or not.
 * @param address - The address to check if it's valid or not.
 */
export function isEthereumAddressValid(address: string): boolean {
  return ethAddressRegex.test(address)
}
