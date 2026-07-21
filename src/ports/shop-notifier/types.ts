export type NotifyItemOnSaleParams = {
  contractAddress: string
  itemId: string
}

// Best-effort, fire-and-forget notifier that tells the Shop server an item has just gone on sale so it
// can email its waitlist subscribers. Every method is fail-safe: it never throws and never blocks the
// caller in a way that could affect trade creation. When SHOP_SERVER_URL / NOTIFY_TRIGGER_TOKEN are not
// configured the port is a clean no-op (feature disabled).
export type IShopNotifierComponent = {
  notifyItemOnSale(params: NotifyItemOnSaleParams): Promise<void>
}
