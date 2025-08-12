import axios from 'axios'

jest.mock('axios')
jest.mock('../../../main/lib/url-utils', () => ({ isUrlSafe: jest.fn() }))
jest.mock('../../../preload/store', () => ({ store: { get: jest.fn() } }))
jest.mock('../../../main/lib/proxy-utils', () => ({ createUtilProxyAgent: jest.fn() }))

import { utilHandlers } from '../../../main/handlers/util-handlers'
import { isUrlSafe } from '../../../main/lib/url-utils'

const axiosMock = axios as jest.MockedFunction<typeof axios>
const isUrlSafeMock = isUrlSafe as jest.MockedFunction<typeof isUrlSafe>

beforeEach(() => {
  axiosMock.mockReset()
  isUrlSafeMock.mockReset()
  isUrlSafeMock.mockResolvedValue(true)
})

describe('fetch-website handler', () => {
  test.each(['GET', 'POST'])('allows %s method', async (method) => {
    axiosMock.mockResolvedValue({ status: 200, headers: {}, data: 'ok' })

    const result = await utilHandlers['fetch-website']({} as any, [
      'https://example.com',
      { method }
    ])

    expect(result.status).toBe(200)
    expect(axiosMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method,
        maxContentLength: 5 * 1024 * 1024,
        maxBodyLength: 5 * 1024 * 1024
      })
    )
  })

  test('rejects disallowed methods', async () => {
    await expect(
      utilHandlers['fetch-website']({} as any, [
        'https://example.com',
        { method: 'DELETE' }
      ])
    ).rejects.toThrow('Unsupported HTTP method')
    expect(axiosMock).not.toHaveBeenCalled()
  })

  test('rejects oversize responses', async () => {
    axiosMock.mockRejectedValue(new Error('maxContentLength size of 5242881 exceeded'))

    await expect(
      utilHandlers['fetch-website']({} as any, ['https://example.com'])
    ).rejects.toThrow('maxContentLength')
    expect(axiosMock).toHaveBeenCalled()
  })
})
