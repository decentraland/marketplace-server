/* 
Wert API Session Parameters Documentation
https://docs.wert.io/docs/fiat-onramp#parameters
*/

type Commodity = {
  commodity: string
  network: string
}

type Wallet = {
  name: string
  network: string
  address: string
}

type Extra = {
  wallets: Wallet[]
}

export type WertSession = {
  // Required parameters
  flow_type: 'simple' | 'simple_full_restrict'

  // Optional parameters
  phone?: string // User's phone number in international format (E. 164 standard). The '+' is optional.
  userID?: string // The User ID for the associated profile

  // Parameters required for simple_full_restrict flow
  commodity?: string // Default crypto asset that will be selected in the module
  network?: string // Network for the default crypto asset
  wallet_address?: string // User's wallet address. It is validated based on the chosen commodity
  commodity_amount?: number // The default crypto amount that will be pre-filled in the module
  currency?: 'USD' | 'EUR' // Your choice of fiat currency. EUR is not available in sandbox environment
  currency_amount?: number // The default amount, in fiat, which will be pre-filled in the module

  // Optional parameters
  commodities?: Commodity[] // Crypto assets that will be available in the module as a stringified JSON of an array of objects
  extra?: Extra // Passing multiple wallet addresses to the widget
}

export type WertSessionResponse = {
  sessionId: string
  requestId: string
}

export type IWertApiComponent = {
  createSession(session: WertSession): Promise<WertSessionResponse>
}
