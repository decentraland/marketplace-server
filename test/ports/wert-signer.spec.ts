import { signSmartContractData } from '@wert-io/widget-sc-signer'
import { createWertSigner } from '../../src/ports/wert-signer/component'
import { Target, WertMessage } from '../../src/ports/wert-signer/types'

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

    describe('when the target is undefined', () => {
      it('should sign the message using the private key', () => {
        const signature = wertSigner.signMessage(wertMessage)

        expect(signSmartContractData).toHaveBeenCalledWith(wertMessage, privateKey)
        expect(signature).toBe(expectedSignature)
      })
    })

    describe('when the target is default', () => {
      it('should sign the message using the private key', () => {
        const signature = wertSigner.signMessage(wertMessage, Target.DEFAULT)

        expect(signSmartContractData).toHaveBeenCalledWith(wertMessage, privateKey)
        expect(signature).toBe(expectedSignature)
      })
    })

    describe('when the target is publicationFees', () => {
      it('should sign the message using the publication fees private key', () => {
        const signature = wertSigner.signMessage(wertMessage, Target.PUBLICATION_FEES)

        expect(signSmartContractData).toHaveBeenCalledWith(wertMessage, publicationFeesPrivateKey)
        expect(signature).toBe(expectedSignature)
      })
    })
  })
})
