import { signSmartContractData } from '@wert-io/widget-sc-signer'
import { IWertSignerComponent, WertMessage } from './types'

export function createWertSigner({ privateKey }: { privateKey: string }): IWertSignerComponent {
  function signMessage(message: WertMessage): string {
    const signedData = signSmartContractData(message, privateKey)
    return signedData.signature
  }

  return {
    signMessage
  }
}
