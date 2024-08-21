/**
 * Gets the last byte as a number from the a signature.
 * @param signature - A ECDSA signature.
 * @returns the last byte of the given signature.
 */
function getLastECDSASignatureByte(signature: string) {
  return Number.parseInt(signature.slice(-2), 16)
}

/**
 * Checks wether a ECDSA signature has a valid V.
 * @param signature - A ECDSA signature.
 * @throws "Invalid signature length" if the given signature has less than 65 bytes.
 * @returns true if the v value is decimal 27 or 28 else otherwise.
 */
export function hasECDSASignatureAValidV(signature: string): boolean {
  const lastSignatureByte = getLastECDSASignatureByte(signature)
  return lastSignatureByte === 27 || lastSignatureByte === 28
}
