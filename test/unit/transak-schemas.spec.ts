import { ISchemaValidatorComponent, createSchemaValidatorComponent } from '@dcl/schema-validator-component'
import { WidgetOptionsSchema } from '../../src/ports/transak/schemas'
import { NFTType } from '../../src/ports/transak/types'

const SCHEMA_KEY = 'widget-options'

let schemaValidator: ISchemaValidatorComponent<Record<string, unknown>>
// Typed as raw data on purpose: the middleware validates whatever `request.json()` returns, so a payload
// the server types do not know about has to be expressible here — that is the whole point of the schema.
let payload: Record<string, unknown>

beforeEach(() => {
  schemaValidator = createSchemaValidatorComponent()
  schemaValidator.addSchema(WidgetOptionsSchema, SCHEMA_KEY)
})

describe('when validating the widget options of a card checkout', () => {
  beforeEach(() => {
    // The body the marketplace webapp actually posts for a primary sale. The schema is a whitelist
    // (`additionalProperties: false`), so every property the clients send has to be spelled out in it.
    payload = {
      calldata: '0xa4fdc78a',
      cryptoCurrencyCode: 'MANA',
      isNFT: true,
      estimatedGasLimit: 70000,
      contractId: 'a-transak-contract-id',
      walletAddress: '0x0000000000000000000000000000000000000001',
      defaultNetwork: 'polygon',
      nftData: [
        {
          imageURL: 'https://peer.decentraland.org/lambdas/collections/contents/urn:some:item/thumbnail',
          nftName: 'Space Combat Boots',
          collectionAddress: '0x0000000000000000000000000000000000000002',
          tokenID: ['210624583337114373395836055367340864637790190801098222508621956702'],
          price: [1],
          quantity: 1,
          nftType: NFTType.ERC721
        }
      ]
    }
  })

  it('should accept it', () => {
    expect(schemaValidator.validateSchema(SCHEMA_KEY, payload)).toEqual({ valid: true, errors: null })
  })

  describe('and it carries a property the schema does not declare', () => {
    beforeEach(() => {
      payload = { ...payload, someUnknownOption: 'whatever' }
    })

    it('should reject it rather than forward it to transak', () => {
      const validation = schemaValidator.validateSchema(SCHEMA_KEY, payload)

      expect(validation.valid).toBe(false)
      expect(validation.errors).toEqual([
        expect.objectContaining({ keyword: 'additionalProperties', params: { additionalProperty: 'someUnknownOption' } })
      ])
    })
  })
})
