export class AccessNotFoundError extends Error {
  constructor(public listId: string, public permission: string, public grantee: string) {
    super("The access doesn't exist.")
  }
}

export class DuplicatedAccessError extends Error {
  constructor(public listId: string, public permission: string, public grantee: string) {
    super('The access already exists for the given list.')
  }
}
