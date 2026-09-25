import { withRetries } from '../../src/logic/retry'

describe('when retrying an operation', () => {
  let sleep: jest.Mock
  let onRetry: jest.Mock

  beforeEach(() => {
    sleep = jest.fn().mockResolvedValue(undefined)
    onRetry = jest.fn()
  })

  it('should return the first success without sleeping', async () => {
    const attempt = jest.fn().mockResolvedValue('ok')

    await expect(withRetries(attempt, [10, 20], { sleep, onRetry })).resolves.toBe('ok')

    expect(attempt).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
    expect(onRetry).not.toHaveBeenCalled()
  })

  it('should wait the given delays between tries and report each retry', async () => {
    const attempt = jest.fn().mockRejectedValueOnce(new Error('one')).mockRejectedValueOnce(new Error('two')).mockResolvedValue('ok')

    await expect(withRetries(attempt, [10, 20], { sleep, onRetry })).resolves.toBe('ok')

    expect(attempt).toHaveBeenCalledTimes(3)
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([10, 20])
    expect(onRetry).toHaveBeenNthCalledWith(1, expect.objectContaining({ message: 'one' }), 10, 1)
    expect(onRetry).toHaveBeenNthCalledWith(2, expect.objectContaining({ message: 'two' }), 20, 2)
  })

  it('should give up after the delays are spent and throw the last failure', async () => {
    const attempt = jest
      .fn()
      .mockRejectedValueOnce(new Error('one'))
      .mockRejectedValueOnce(new Error('two'))
      .mockRejectedValue(new Error('three'))

    await expect(withRetries(attempt, [10, 20], { sleep })).rejects.toThrow('three')

    expect(attempt).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(2)
  })

  it('should try exactly once with no delays', async () => {
    const attempt = jest.fn().mockRejectedValue(new Error('only'))

    await expect(withRetries(attempt, [], { sleep })).rejects.toThrow('only')

    expect(attempt).toHaveBeenCalledTimes(1)
  })
})
