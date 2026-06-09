import { signSmartContractData } from '@wert-io/widget-sc-signer'
import { Target } from '../types'
import { IWertSignerComponent, WertMessage } from './types'
import { validateWertMessage } from './validation'

export function createWertSigner({
  privateKey,
  publicationFeesPrivateKey
}: {
  privateKey: string
  publicationFeesPrivateKey: string
}): IWertSignerComponent {
  function signMessage(message: WertMessage, target?: Target): string {
    validateWertMessage(message, target)
    const targetPrivateKey = target === Target.PUBLICATION_FEES ? publicationFeesPrivateKey : privateKey
    const signedData = signSmartContractData(message, targetPrivateKey)
    return signedData.signature
  }

  return {
    signMessage
  }
}
