import { signSmartContractData } from '@wert-io/widget-sc-signer'
import { Interface } from 'ethers'
import { ContractName, getContract } from 'decentraland-transactions'
import { getEthereumChainId, getPolygonChainId } from '../../src/logic/chainIds'
import { createWertSigner } from '../../src/ports/wert/signer/component'
import { InvalidWertMessageError } from '../../src/ports/wert/signer/errors'
import { WertMessage } from '../../src/ports/wert/signer/types'
import { Target } from '../../src/ports/wert/types'

jest.mock('@wert-io/widget-sc-signer')

function buildSelector(abi: object[], functionName: string): string {
  const fragment = new Interface(abi as ConstructorParameters<typeof Interface>[0]).getFunction(functionName)
  if (!fragment) {
    throw new Error(`The function "${functionName}" was not found in the provided ABI`)
  }
  return fragment.selector
}

describe('createWertSigner', () => {
  const privateKey = 'myPrivateKey'
  const publicationFeesPrivateKey = 'myPublicationFeesPrivateKey'
  const wertSigner = createWertSigner({ privateKey, publicationFeesPrivateKey })

  describe('signMessage', () => {
    let defaultMessage: WertMessage
    let publicationFeesMessage: WertMessage
    let expectedSignature: string

    beforeEach(() => {
      const ensController = getContract(ContractName.DCLControllerV2, getEthereumChainId())
      const collectionManager = getContract(ContractName.CollectionManager, getPolygonChainId())
      defaultMessage = {
        address: 'myAddress',
        commodity: 'MANA',
        commodity_amount: 100,
        network: 'ethereum',
        sc_address: ensController.address,
        sc_input_data: `${buildSelector(ensController.abi, 'register')}deadbeef`
      }
      publicationFeesMessage = {
        address: 'myAddress',
        commodity: 'MANA',
        commodity_amount: 50,
        network: 'polygon',
        sc_address: collectionManager.address,
        sc_input_data: `${buildSelector(collectionManager.abi, 'createCollection')}deadbeef`
      }
      expectedSignature = 'mySignature'
      ;(signSmartContractData as jest.Mock) = jest.fn().mockReturnValue({ signature: expectedSignature })
    })

    afterEach(() => {
      jest.clearAllMocks()
    })

    describe('when the target is undefined', () => {
      it('should sign the message using the private key', () => {
        const signature = wertSigner.signMessage(defaultMessage)

        expect(signSmartContractData).toHaveBeenCalledWith(defaultMessage, privateKey)
        expect(signature).toBe(expectedSignature)
      })
    })

    describe('when the target is default', () => {
      it('should sign the message using the private key', () => {
        const signature = wertSigner.signMessage(defaultMessage, Target.DEFAULT)

        expect(signSmartContractData).toHaveBeenCalledWith(defaultMessage, privateKey)
        expect(signature).toBe(expectedSignature)
      })
    })

    describe('when the target is publicationFees', () => {
      it('should sign the message using the publication fees private key', () => {
        const signature = wertSigner.signMessage(publicationFeesMessage, Target.PUBLICATION_FEES)

        expect(signSmartContractData).toHaveBeenCalledWith(publicationFeesMessage, publicationFeesPrivateKey)
        expect(signature).toBe(expectedSignature)
      })
    })

    describe('when the message targets a contract that is not allowed', () => {
      beforeEach(() => {
        defaultMessage.sc_address = '0x000000000000000000000000000000000000dead'
      })

      it('should throw an invalid wert message error without signing', () => {
        expect(() => wertSigner.signMessage(defaultMessage, Target.DEFAULT)).toThrow(InvalidWertMessageError)
        expect(signSmartContractData).not.toHaveBeenCalled()
      })
    })
  })
})
