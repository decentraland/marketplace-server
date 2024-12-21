export class FetchRentalListingsError extends Error {
  constructor(response: unknown) {
    super(`There was an error fetching rental listings ${response}`)
  }
}

export class ParseRentalListingResponseError extends Error {
  constructor(response: unknown) {
    super(`There was an error parsing rental listing response body ${response}`)
  }
}
