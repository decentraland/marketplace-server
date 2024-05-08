export class ListNotFoundError extends Error {
  constructor(public listId: string) {
    super('The list was not found.')
  }
}

export class ListsNotFoundError extends Error {
  constructor(public listIds: string[]) {
    super('Some lists were not found.')
  }
}

export class PickAlreadyExistsError extends Error {
  constructor(public listId: string, public itemId: string) {
    super('The item was already favorited.')
  }
}

export class PickNotFoundError extends Error {
  constructor(public listId: string, public itemId: string) {
    super('The pick does not exist or is not accessible by this user.')
  }
}

export class QueryFailure extends Error {
  constructor(message: string) {
    super(`Querying the subgraph failed: ${message}`)
  }
}

export class DuplicatedListError extends Error {
  constructor(public name: string) {
    super(`There is already a list with the same name: ${name}.`)
  }
}
