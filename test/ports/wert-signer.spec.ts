import { signSmartContractData } from '@wert-io/widget-sc-signer'
import { createWertSigner } from '../../src/ports/wert-signer/component'
import { WertMessage } from '../../src/ports/wert-signer/types'

jest.mock('@wert-io/widget-sc-signer')

describe('createWertSigner', () => {
  const privateKey = 'myPrivateKey'
  const publicationFeesPrivateKey = 'myPublicationFeesPrivateKey'
  const wertSigner = createWertSigner({ privateKey, publicationFeesPrivateKey })

  describe('signMessage', () => {
    let wertMessage: WertMessage
    let expectedSignature: string
    beforeEach(() => {
      wertMessage = {
        address: 'myAddress',
        commodity: 'MANA',
        commodity_amount: 100,
        network: 'myNetwork',
        sc_address: 'myScAddress',
        sc_input_data: 'myScInputData'
      }
      ;(expectedSignature = 'mySignature'),
        ((signSmartContractData as jest.Mock) = jest.fn().mockReturnValue({ signature: expectedSignature }))
    })
    it('should sign the message using the private key', () => {
      const signature = wertSigner.signMessage(wertMessage)

      expect(signSmartContractData).toHaveBeenCalledWith(wertMessage, privateKey)
      expect(signature).toBe(expectedSignature)
    })
  })
})
