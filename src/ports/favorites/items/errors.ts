export class ItemNotFoundError extends Error {
  constructor(public itemId: string) {
    super("The item trying to get saved doesn't exist.")
  }
}
