import { IHttpServerComponent } from '@well-known-components/interfaces'
import { asJSON } from '../../logic/http/response'
import { AppComponents, Context } from '../../types'

export function createBalanceHandler(
  components: Pick<AppComponents, 'balances'>
): IHttpServerComponent.IRequestHandler<Context<'/v1/:chainId/address/:wallet/balance'>> {
  const { balances } = components

  return async context => {
    const { wallet, chainId } = context.params

    return asJSON(async () => {
      return await balances.getAddressChainBalance(chainId, wallet)
    })
  }
}
