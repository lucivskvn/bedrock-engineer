import { beforeEach, describe, expect, jest, test } from '@jest/globals'
import { HEALTH_ISSUES, HEALTH_STATUS } from '../../../common/health'

const mockLogger = {
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  verbose: jest.fn()
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  jest.resetModules()
  jest.clearAllMocks()
})

async function loadStoreStatusModule() {
  // @ts-expect-error nodeNext module resolution allows extensionless imports in Jest
  // eslint-disable-next-line no-restricted-syntax
  return await import('../health/store-status')
}

describe('getConfigStoreHealthComponent', () => {
  test('transitions from initializing to ok when store becomes ready', async () => {
    const deferred = createDeferred<void>()
    jest.doMock('../../../common/logger', () => ({
      createCategoryLogger: () => mockLogger
    }))
    jest.doMock('../../../preload/store', () => ({
      storeReady: deferred.promise
    }))

    const module = await loadStoreStatusModule()
    const { getConfigStoreHealthComponent } = module

    expect(getConfigStoreHealthComponent().status).toBe(HEALTH_STATUS.INITIALIZING)

    deferred.resolve()
    await deferred.promise

    expect(getConfigStoreHealthComponent().status).toBe(HEALTH_STATUS.OK)
    expect(mockLogger.error).not.toHaveBeenCalled()
  })

  test('reports error when store initialization fails', async () => {
    const error = new Error('store failed')
    const deferred = createDeferred<void>()
    deferred.reject(error)
    deferred.promise.catch(() => undefined)

    jest.doMock('../../../common/logger', () => ({
      createCategoryLogger: () => mockLogger
    }))
    jest.doMock('../../../preload/store', () => ({
      storeReady: deferred.promise
    }))

    const module = await loadStoreStatusModule()
    const { getConfigStoreHealthComponent } = module

    await Promise.resolve()

    const component = getConfigStoreHealthComponent()
    expect(component.status).toBe(HEALTH_STATUS.ERROR)
    expect(component.issues).toContain(HEALTH_ISSUES.CONFIG_STORE_UNAVAILABLE)
    expect(mockLogger.error).toHaveBeenCalledWith('Configuration store failed to initialize', {
      error: expect.objectContaining({ name: 'Error' })
    })
  })
})
