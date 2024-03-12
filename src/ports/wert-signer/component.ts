import { signSmartContractData } from '@wert-io/widget-sc-signer'
import { IWertSignerComponent, Target, WertMessage } from './types'

export function createWertSigner({
  privateKey,
  publicationFeesPrivateKey
}: {
  privateKey: string
  publicationFeesPrivateKey: string
}): IWertSignerComponent {
  function signMessage(message: WertMessage, target?: Target): string {
    const targetPrivateKey = target === Target.PUBLICATION_FEES ? publicationFeesPrivateKey : privateKey
    const signedData = signSmartContractData(message, targetPrivateKey)
    return signedData.signature
  }

  return {
    signMessage
  }
}
