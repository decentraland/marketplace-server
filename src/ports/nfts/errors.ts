export class InvalidSearchByTenantAndOwnerError extends Error {
  constructor() {
    super('Owner or tenant can be set, but not both.')
  }
}

export class InvalidTokenIdError extends Error {
  constructor() {
    super('Invalid token id, token ids must be numbers')
  }
}

export class MissingContractAddressParamError extends Error {
  constructor() {
    super("NFTs can't be queried by token id if no contract address is provided")
  }
}
