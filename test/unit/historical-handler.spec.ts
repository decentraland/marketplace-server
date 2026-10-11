/* eslint-disable @typescript-eslint/unbound-method */
import {
  getHistoricalEstatesHandler,
  getHistoricalNftsHandler,
  getHistoricalRentalAssetsHandler
} from '../../src/controllers/handlers/historical-handler'
import { BlockTooRecentError, HistoricalBusyError, HistoricalUnavailableError, IHistoricalComponent } from '../../src/ports/historical'
import { StatusCode } from '../../src/types'
import { createLoggerMockedComponent } from '../mocks/logger-mock'

const OWNER = '0x0000000000000000000000000000000000000a11'

let historical: jest.Mocked<IHistoricalComponent>
let logError: jest.Mock

/** The handlers read only the components and the request's JSON body. */
const context = <C>(body: unknown) =>
  ({
    components: { historical, logs: createLoggerMockedComponent({ error: logError }) },
    request: new Request('http://example.com', { method: 'POST', body: JSON.stringify(body) })
  } as unknown as C)

beforeEach(() => {
  historical = { getNfts: jest.fn(), getEstates: jest.fn(), getRentalAssets: jest.fn() }
  logError = jest.fn()
})

describe('when getting the NFTs held at a block', () => {
  beforeEach(() => {
    historical.getNfts.mockResolvedValue([])
  })

  it('should pass the filters with the default page', async () => {
    const result = await getHistoricalNftsHandler(
      context<Parameters<typeof getHistoricalNftsHandler>[0]>({ block: 100, owners: [OWNER], category: 'estate', estateSizeGt: 0 })
    )

    expect(result).toEqual({ status: StatusCode.OK, body: { ok: true, data: [] } })
    expect(historical.getNfts).toHaveBeenCalledWith({
      block: 100,
      owners: [OWNER],
      category: 'estate',
      contractAddresses: undefined,
      itemTypes: undefined,
      estateSizeGt: 0,
      idGt: undefined,
      first: 100,
      skip: 0
    })
  })
})

describe('when getting NFTs with neither a category nor contracts', () => {
  it('should answer with a bad request, without reading anything', async () => {
    const result = await getHistoricalNftsHandler(
      context<Parameters<typeof getHistoricalNftsHandler>[0]>({ block: 100, owners: [OWNER], contractAddresses: [] })
    )

    expect(result.status).toBe(StatusCode.BAD_REQUEST)
    expect(historical.getNfts).not.toHaveBeenCalled()
  })
})

describe('when the block is too recent', () => {
  beforeEach(() => {
    historical.getEstates.mockRejectedValue(new BlockTooRecentError(100))
  })

  it('should answer that the service is unavailable, so the caller retries', async () => {
    const result = await getHistoricalEstatesHandler(
      context<Parameters<typeof getHistoricalEstatesHandler>[0]>({ block: 100, tokenIds: ['1'] })
    )

    expect(result).toEqual({
      status: StatusCode.SERVICE_UNAVAILABLE,
      headers: { 'Retry-After': '60' },
      body: { ok: false, code: 'block-too-recent', message: new BlockTooRecentError(100).message }
    })
  })
})

describe('when too many reads are running', () => {
  beforeEach(() => {
    historical.getNfts.mockRejectedValue(new HistoricalBusyError())
  })

  it('should answer that the service is unavailable for a few seconds', async () => {
    const result = await getHistoricalNftsHandler(
      context<Parameters<typeof getHistoricalNftsHandler>[0]>({ block: 100, owners: [OWNER], category: 'wearable' })
    )

    expect(result).toEqual(
      expect.objectContaining({
        status: StatusCode.SERVICE_UNAVAILABLE,
        headers: { 'Retry-After': '5' },
        body: expect.objectContaining({ code: 'busy' })
      })
    )
  })
})

describe('when the RPC or a squid does not answer', () => {
  beforeEach(() => {
    historical.getEstates.mockRejectedValue(new HistoricalUnavailableError("the registry squid's height: permission denied"))
  })

  it('should answer that the service is unavailable for a while, and log why', async () => {
    const result = await getHistoricalEstatesHandler(
      context<Parameters<typeof getHistoricalEstatesHandler>[0]>({ block: 100, tokenIds: ['1'] })
    )

    expect(result).toEqual({
      status: StatusCode.SERVICE_UNAVAILABLE,
      headers: { 'Retry-After': '30' },
      body: { ok: false, code: 'unavailable', message: 'Could not fetch the estates right now' }
    })
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('permission denied'))
  })
})

describe('when reading the holdings fails', () => {
  beforeEach(() => {
    historical.getRentalAssets.mockRejectedValue(new Error('connection reset'))
  })

  it('should answer with an internal server error that does not tell the details, and log them', async () => {
    const result = await getHistoricalRentalAssetsHandler(
      context<Parameters<typeof getHistoricalRentalAssetsHandler>[0]>({
        block: 100,
        lessors: [OWNER],
        isClaimed: false,
        first: 1000,
        skip: 5
      })
    )

    expect(result).toEqual({ status: StatusCode.INTERNAL_SERVER_ERROR, body: { ok: false, message: 'Could not fetch the rental assets' } })
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('connection reset'))
    expect(historical.getRentalAssets).toHaveBeenCalledWith({
      block: 100,
      lessors: [OWNER],
      contractAddresses: undefined,
      isClaimed: false,
      first: 1000,
      skip: 5
    })
  })
})
