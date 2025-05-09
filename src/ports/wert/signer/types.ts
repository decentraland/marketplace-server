import { Target } from '../types'

export type WertMessage = {
  address: string
  commodity: string
  commodity_amount: number
  network: string
  sc_address: string
  sc_input_data: string
}

export type IWertSignerComponent = {
  signMessage(message: WertMessage, target?: Target): string
}
