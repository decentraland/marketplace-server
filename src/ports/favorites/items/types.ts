export interface IItemsComponent {
  validateItemExists(itemId: string): Promise<void>
}
