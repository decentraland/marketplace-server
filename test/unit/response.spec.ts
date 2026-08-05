import { asJSON, HttpError } from '../../src/logic/http/response'

describe('asJSON', () => {
  let errSpy: jest.SpyInstance

  beforeEach(() => {
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    errSpy.mockRestore()
  })

  it('returns 200 with the handler result and does not log', async () => {
    const res = await asJSON(async () => ({ ok: true }))

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
    expect(errSpy).not.toHaveBeenCalled()
  })

  it('maps an HttpError to its status, without logging a 4xx (normal control flow)', async () => {
    const res = await asJSON(async () => {
      throw new HttpError('bad request', 400)
    })

    expect(res.status).toBe(400)
    expect(res.body).toBe('bad request')
    expect(errSpy).not.toHaveBeenCalled()
  })

  it('logs a 5xx HttpError (a real server fault)', async () => {
    const res = await asJSON(async () => {
      throw new HttpError('upstream down', 503)
    })

    expect(res.status).toBe(503)
    expect(errSpy).toHaveBeenCalled()
  })

  it('maps an unexpected error to 500 AND logs the real error (so 500s are debuggable)', async () => {
    const boom = new Error('relation "marketplace.mv_trades" does not exist')
    const res = await asJSON(async () => {
      throw boom
    })

    expect(res.status).toBe(500)
    expect(res.body).toBe(boom.message)
    // The actual error object (message + stack) must reach the logs — the whole point of the fix.
    expect(errSpy).toHaveBeenCalled()
    expect(errSpy.mock.calls.some(call => call.includes(boom))).toBe(true)
  })
})
