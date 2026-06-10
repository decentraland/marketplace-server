import { Interface } from 'ethers'
import { ChainId } from '@dcl/schemas'
import { ContractName, getContract } from 'decentraland-transactions'
import { getEthereumChainId, getPolygonChainId } from '../../src/logic/chainIds'
import { InvalidWertMessageError } from '../../src/ports/wert/signer/errors'
import { WertMessage } from '../../src/ports/wert/signer/types'
import { validateWertMessage } from '../../src/ports/wert/signer/validation'
import { Target } from '../../src/ports/wert/types'

function buildSelector(abi: object[], functionName: string): string {
  const fragment = new Interface(abi as ConstructorParameters<typeof Interface>[0]).getFunction(functionName)
  if (!fragment) {
    throw new Error(`The function "${functionName}" was not found in the provided ABI`)
  }
  return fragment.selector
}

describe('when validating a wert message', () => {
  let ensControllerAddress: string
  let registerSelector: string
  let collectionManagerAddress: string
  let createCollectionSelector: string

  beforeEach(() => {
    const ensController = getContract(ContractName.DCLControllerV2, getEthereumChainId())
    const collectionManager = getContract(ContractName.CollectionManager, getPolygonChainId())
    ensControllerAddress = ensController.address
    registerSelector = buildSelector(ensController.abi, 'register')
    collectionManagerAddress = collectionManager.address
    createCollectionSelector = buildSelector(collectionManager.abi, 'createCollection')
  })

  describe('and the target is the default one', () => {
    let message: WertMessage

    beforeEach(() => {
      message = {
        address: '0x1234567890123456789012345678901234567890',
        commodity: 'MANA',
        commodity_amount: 100,
        network: 'ethereum',
        sc_address: ensControllerAddress,
        sc_input_data: `${registerSelector}deadbeef`
      }
    })

    describe('and the contract address and function selector are allowed', () => {
      it('should not throw', () => {
        expect(() => validateWertMessage(message, Target.DEFAULT)).not.toThrow()
      })
    })

    describe('and the target is not provided', () => {
      it('should validate it against the default target and not throw', () => {
        expect(() => validateWertMessage(message, undefined)).not.toThrow()
      })
    })

    describe('and the contract address is upper-cased', () => {
      beforeEach(() => {
        message.sc_address = ensControllerAddress.toUpperCase()
      })

      it('should match the allowlist case-insensitively and not throw', () => {
        expect(() => validateWertMessage(message, Target.DEFAULT)).not.toThrow()
      })
    })

    describe('and the contract address is not allowed', () => {
      beforeEach(() => {
        message.sc_address = '0x000000000000000000000000000000000000dead'
      })

      it('should throw an invalid wert message error about the contract address', () => {
        expect(() => validateWertMessage(message, Target.DEFAULT)).toThrow(InvalidWertMessageError)
      })
    })

    describe('and the function selector is not allowed', () => {
      beforeEach(() => {
        message.sc_input_data = `${createCollectionSelector}deadbeef`
      })

      it('should throw an invalid wert message error about the contract call', () => {
        expect(() => validateWertMessage(message, Target.DEFAULT)).toThrow(InvalidWertMessageError)
      })
    })

    describe('and the calldata is missing', () => {
      beforeEach(() => {
        message.sc_input_data = ''
      })

      it('should throw an invalid wert message error', () => {
        expect(() => validateWertMessage(message, Target.DEFAULT)).toThrow(InvalidWertMessageError)
      })
    })

    describe('and the calldata is too short to contain a selector', () => {
      beforeEach(() => {
        message.sc_input_data = '0x1e59'
      })

      it('should throw an invalid wert message error', () => {
        expect(() => validateWertMessage(message, Target.DEFAULT)).toThrow(InvalidWertMessageError)
      })
    })

    describe('and an extra contract address is allowlisted via the environment', () => {
      const extraAddress = '0x000000000000000000000000000000000000beef'

      beforeEach(() => {
        process.env.WERT_DEFAULT_ALLOWED_CONTRACTS = `${extraAddress},0x000000000000000000000000000000000000cafe`
        message.sc_address = extraAddress
      })

      afterEach(() => {
        delete process.env.WERT_DEFAULT_ALLOWED_CONTRACTS
      })

      it('should accept the additional contract address and not throw', () => {
        expect(() => validateWertMessage(message, Target.DEFAULT)).not.toThrow()
      })
    })

    describe('and the configured ethereum chain is sepolia and the dev fiat names controller is used', () => {
      let originalEthereumChainId: string | undefined

      beforeEach(() => {
        originalEthereumChainId = process.env.ETHEREUM_CHAIN_ID
        process.env.ETHEREUM_CHAIN_ID = ChainId.ETHEREUM_SEPOLIA.toString()
        message.sc_address = '0x39421866645065c8d53e2d36906946f33465743d'
      })

      afterEach(() => {
        if (originalEthereumChainId === undefined) {
          delete process.env.ETHEREUM_CHAIN_ID
        } else {
          process.env.ETHEREUM_CHAIN_ID = originalEthereumChainId
        }
      })

      it('should accept the seeded dev contract and not throw', () => {
        expect(() => validateWertMessage(message, Target.DEFAULT)).not.toThrow()
      })
    })
  })

  describe('and the target is the publication fees one', () => {
    let message: WertMessage

    beforeEach(() => {
      message = {
        address: '0x1234567890123456789012345678901234567890',
        commodity: 'MANA',
        commodity_amount: 50,
        network: 'polygon',
        sc_address: collectionManagerAddress,
        sc_input_data: `${createCollectionSelector}deadbeef`
      }
    })

    describe('and the contract address and function selector are allowed', () => {
      it('should not throw', () => {
        expect(() => validateWertMessage(message, Target.PUBLICATION_FEES)).not.toThrow()
      })
    })

    describe('and the contract address belongs to a different target', () => {
      beforeEach(() => {
        message.sc_address = ensControllerAddress
      })

      it('should throw an invalid wert message error about the contract address', () => {
        expect(() => validateWertMessage(message, Target.PUBLICATION_FEES)).toThrow(InvalidWertMessageError)
      })
    })

    describe('and the function selector belongs to a different target', () => {
      beforeEach(() => {
        message.sc_input_data = `${registerSelector}deadbeef`
      })

      it('should throw an invalid wert message error about the contract call', () => {
        expect(() => validateWertMessage(message, Target.PUBLICATION_FEES)).toThrow(InvalidWertMessageError)
      })
    })
  })
})
