import { ChainId, Network } from '@dcl/schemas'

export class TradeAlreadyExpiredError extends Error {
  constructor() {
    super('Trade expiration date must be in the future')
  }
}

export class TradeEffectiveAfterExpirationError extends Error {
  constructor() {
    super('Trade should be effective before expiration')
  }
}

export class InvalidTradeStructureError extends Error {
  constructor(public type: string) {
    super(`Trade structure is not valid for type ${type}`)
  }
}

export class InvalidTradeSignerError extends Error {
  constructor() {
    super('Trade and request signer do not match')
  }
}

export class InvalidTradeSignatureError extends Error {
  constructor() {
    super('Invalid signature')
  }
}

export class MarketplaceContractNotFound extends Error {
  constructor(public chainId: ChainId, public network: Network) {
    super(`Contract not found for ${chainId} and ${network}`)
  }
}

export class DuplicatedBidError extends Error {
  constructor() {
    super('There is already a bid with the same parameters')
  }
}
