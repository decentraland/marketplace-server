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

export class InvalidTradeSignatureError extends Error {
  constructor() {
    super('Invalid signature')
  }
}

export class DuplicatedBidError extends Error {
  constructor() {
    super('There is already a bid with the same parameters')
  }
}
