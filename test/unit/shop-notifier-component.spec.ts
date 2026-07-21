import { IConfigComponent, ILoggerComponent } from '@well-known-components/interfaces'
import { IFetchComponent } from '@dcl/core-commons'
import { createShopNotifierComponent } from '../../src/ports/shop-notifier/component'
import { IShopNotifierComponent } from '../../src/ports/shop-notifier/types'
import { createTestLogsComponent } from '../components'

const SHOP_SERVER_URL = 'https://shop-api.example.org'
const NOTIFY_TRIGGER_TOKEN = 'example-shared-secret-rotate-me'

let config: IConfigComponent
let fetchComponent: IFetchComponent
let fetchMock: jest.Mock
let logs: ILoggerComponent
let getStringMock: jest.Mock

function buildConfig(values: Record<string, string | undefined>): IConfigComponent {
  getStringMock = jest.fn().mockImplementation((key: string) => Promise.resolve(values[key]))
  return {
    getString: getStringMock,
    getNumber: jest.fn(),
    requireString: jest.fn(),
    requireNumber: jest.fn()
  }
}

describe('when creating the shop notifier component', () => {
  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue({ status: 200, ok: true, json: () => Promise.resolve({}) })
    fetchComponent = { fetch: fetchMock } as unknown as IFetchComponent
    logs = createTestLogsComponent({
      getLogger: jest.fn().mockReturnValue({ error: () => undefined, info: () => undefined, warn: () => undefined })
    })
  })

  describe('and both SHOP_SERVER_URL and NOTIFY_TRIGGER_TOKEN are configured', () => {
    let notifier: IShopNotifierComponent

    beforeEach(async () => {
      config = buildConfig({ SHOP_SERVER_URL, NOTIFY_TRIGGER_TOKEN })
      notifier = await createShopNotifierComponent({ config, logs, fetch: fetchComponent })
    })

    it('should POST to the shop notify endpoint with the bearer token and body', async () => {
      await notifier.notifyItemOnSale({ contractAddress: '0xabc', itemId: '42' })
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]
      const headers = init.headers as Record<string, string>
      expect(url).toBe(`${SHOP_SERVER_URL}/notify/item-on-sale`)
      expect(init.method).toBe('POST')
      expect(headers['Content-Type']).toBe('application/json')
      expect(headers['Authorization']).toBe(`Bearer ${NOTIFY_TRIGGER_TOKEN}`)
      expect(init.body).toBe(JSON.stringify({ contractAddress: '0xabc', itemId: '42' }))
    })

    it('should never throw when the fetch rejects', async () => {
      fetchMock.mockRejectedValueOnce(new Error('network down'))
      await expect(notifier.notifyItemOnSale({ contractAddress: '0xabc', itemId: '42' })).resolves.toBeUndefined()
    })
  })

  describe('and SHOP_SERVER_URL is not configured', () => {
    let notifier: IShopNotifierComponent

    beforeEach(async () => {
      config = buildConfig({ SHOP_SERVER_URL: undefined, NOTIFY_TRIGGER_TOKEN })
      notifier = await createShopNotifierComponent({ config, logs, fetch: fetchComponent })
    })

    it('should be a no-op and not call fetch', async () => {
      await notifier.notifyItemOnSale({ contractAddress: '0xabc', itemId: '42' })
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('and NOTIFY_TRIGGER_TOKEN is not configured', () => {
    let notifier: IShopNotifierComponent

    beforeEach(async () => {
      config = buildConfig({ SHOP_SERVER_URL, NOTIFY_TRIGGER_TOKEN: undefined })
      notifier = await createShopNotifierComponent({ config, logs, fetch: fetchComponent })
    })

    it('should be a no-op and not call fetch', async () => {
      await notifier.notifyItemOnSale({ contractAddress: '0xabc', itemId: '42' })
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })
})
