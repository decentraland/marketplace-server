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

export class TradeNotFoundError extends Error {
  constructor(public tradeId: string) {
    super(`Trade not found for id ${tradeId}`)
  }
}

export class DuplicateNFTOrderError extends Error {
  constructor() {
    super('There is already an open order for this NFT')
  }
}

export class DuplicateItemOrderError extends Error {
  constructor() {
    super('There is already an open order for this Item')
  }
}

export class InvalidECDSASignatureError extends Error {
  constructor() {
    super('The server does not accept ECDSA signatures with V as 0 or 1')
  }
}

export class TradeNotFoundBySignatureError extends Error {
  constructor(public signature: string) {
    super(`Trade not found for signature ${signature}`)
  }
}

export class EventNotGeneratedError extends Error {
  constructor() {
    super('Event could not be generated')
  }
}
