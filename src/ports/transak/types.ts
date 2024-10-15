export type ITransakComponent = {
  getOrder(orderId: string): Promise<OrderResponse>
}

export enum TransakOrderStatus {
  AWAITING_PAYMENT_FROM_USER = 'AWAITING_PAYMENT_FROM_USER',
  PAYMENT_DONE_MARKED_BY_USER = 'PAYMENT_DONE_MARKED_BY_USER',
  PROCESSING = 'PROCESSING',
  PENDING_DELIVERY_FROM_TRANSAK = 'PENDING_DELIVERY_FROM_TRANSAK',
  ON_HOLD_PENDING_DELIVERY_FROM_TRANSAK = 'ON_HOLD_PENDING_DELIVERY_FROM_TRANSAK',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
  EXPIRED = 'EXPIRED'
}

export type OrderData = {
  eventName: string
  status: {
    id: string
    autoExpiresAt: string
    conversionPrice: number
    convertedFiatAmount: number
    convertedFiatCurrency: string
    createdAt: string
    cryptoAmount: number
    cryptoCurrency: string
    cryptocurrency: string
    envName: string
    fiatAmount: number
    fiatCurrency: string
    fromWalletAddress: string
    isBuyOrSell: 'BUY' | 'SELL'
    isNFTOrder: boolean
    transactionLink?: string
    transactionHash?: string
    network: 'ethereum' | 'matic'
    nftAssetInfo?: {
      collection: string
      tokenId: string[]
    }
    paymentOptionId: string
    quoteId: string
    referenceCode: number
    reservationId: string
    status: TransakOrderStatus
    totalFeeInFiat: number
    walletAddress: string
    walletLink: string
  }
}

export type OrderResponse = {
  meta: {
    orderId: string
  }
  data: Pick<OrderData['status'], 'id' | 'status' | 'transactionHash' | 'walletAddress'> & {
    errorMessage: string | null
  }
}
