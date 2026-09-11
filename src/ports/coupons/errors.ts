export class InvalidCouponSignerError extends Error {
  constructor() {
    super('Coupon and request signer do not match')
  }
}

export class UnsupportedCouponChainError extends Error {
  constructor(public chainId: number) {
    super(`Coupons are not available on chain ${chainId}`)
  }
}

export class InvalidCouponNetworkError extends Error {
  constructor() {
    super('The coupon network does not match its chain')
  }
}

export class CouponAlreadyUnusableError extends Error {
  constructor(message: string) {
    super(message)
  }
}

export class InvalidCouponAddressError extends Error {
  constructor() {
    super('The coupon address is not the collection discount coupon of this chain')
  }
}

export class InvalidCouponDiscountError extends Error {
  constructor(message: string) {
    super(message)
  }
}

export class InvalidCouponCollectionsError extends Error {
  constructor(message: string) {
    super(message)
  }
}

export class InvalidCouponChecksError extends Error {
  constructor(message: string) {
    super(message)
  }
}

export class InvalidCouponSignatureError extends Error {
  constructor() {
    super('Invalid coupon signature')
  }
}

export class NotCollectionCreatorError extends Error {
  constructor(public collection: string) {
    super(`The signer is not the creator of collection ${collection}`)
  }
}

export class InvalidCouponSignatureIndexError extends Error {
  constructor() {
    super('The coupon signature indexes do not match the current on-chain values')
  }
}

export class DuplicateCouponError extends Error {
  constructor() {
    super('This coupon already exists')
  }
}

export class CouponNotFoundError extends Error {
  constructor(public id: string) {
    super(`Coupon not found for id ${id}`)
  }
}
