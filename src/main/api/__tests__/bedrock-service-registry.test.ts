import { getBedrockService, resetBedrockService, __test__ } from '../bedrock-service-registry'
import { BedrockService } from '../bedrock'

jest.mock('../bedrock', () => ({
  BedrockService: jest.fn().mockImplementation(() => ({
    marker: Symbol('bedrock-service')
  }))
}))

jest.mock('../../../preload/store', () => ({
  store: {},
  storeReady: Promise.resolve()
}))

describe('bedrock-service-registry', () => {
  beforeEach(() => {
    resetBedrockService()
    jest.clearAllMocks()
  })

  it('caches the bedrock service instance', async () => {
    const first = await getBedrockService()
    const second = await getBedrockService()

    expect(first).toBe(second)
  })

  it('allows overriding the cached instance for tests', async () => {
    const stubService = { marker: 'test-service' } as unknown as BedrockService
    __test__.setBedrockService(stubService)

    const service = await getBedrockService()

    expect(service).toBe(stubService)
  })
})
