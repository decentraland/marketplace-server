export class WornNeighborsUnavailableError extends Error {
  constructor(public readonly cause: unknown) {
    super(`The asset-bundle-registry database could not be read for co-wear neighbours: ${describe(cause)}`)
  }
}

/** Never let a pg error reach a message with its connection string attached. */
function describe(error: unknown): string {
  if (error && typeof error === 'object') {
    const e = error as { code?: string; message?: string }
    return `${e.code ?? 'ERR'}: ${e.message ?? 'unknown database error'}`
  }
  return 'unknown error'
}
