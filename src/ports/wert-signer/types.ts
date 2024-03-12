export type WertMessage = {
  address: string
  commodity: string
  commodity_amount: number
  network: string
  sc_address: string
  sc_input_data: string
}

export enum Target {
  DEFAULT = 'default',
  PUBLICATION_FEES = 'publicationFees'
}

export type IWertSignerComponent = {
  signMessage(message: WertMessage, target?: Target): string
}
