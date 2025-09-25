import { ICacheStorageComponent } from '@dcl/core-commons'

export function createCacheMockedComponent({
  get = jest.fn(),
  set = jest.fn(),
  remove = jest.fn(),
  keys = jest.fn(),
  setInHash = jest.fn(),
  getFromHash = jest.fn(),
  removeFromHash = jest.fn(),
  getAllHashFields = jest.fn(),
  acquireLock = jest.fn(),
  releaseLock = jest.fn(),
  tryAcquireLock = jest.fn(),
  tryReleaseLock = jest.fn()
}: Partial<jest.Mocked<ICacheStorageComponent>> = {}): jest.Mocked<ICacheStorageComponent> {
  return {
    get,
    set,
    remove,
    keys,
    setInHash,
    getFromHash,
    removeFromHash,
    getAllHashFields,
    acquireLock,
    releaseLock,
    tryAcquireLock,
    tryReleaseLock
  }
}
