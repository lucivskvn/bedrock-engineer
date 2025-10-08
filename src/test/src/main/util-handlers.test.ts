import axios from 'axios'

jest.mock('axios')
jest.mock('../../../main/lib/url-utils', () => ({ isUrlSafe: jest.fn() }))
jest.mock('../../../preload/store', () => ({ store: { get: jest.fn() } }))
jest.mock('../../../main/lib/proxy-utils', () => ({ createUtilProxyAgent: jest.fn() }))

import { utilHandlers } from '../../../main/handlers/util-handlers'
import { isUrlSafe } from '../../../main/lib/url-utils'
import { MAX_FETCH_BODY_BYTES } from '../../../main/handlers/fetch-guards'

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
        validateStatus: null,
        maxRedirects: 0,
        maxContentLength: MAX_FETCH_BODY_BYTES,
        maxBodyLength: MAX_FETCH_BODY_BYTES
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

  test('follows safe redirects for GET requests', async () => {
    axiosMock
      .mockResolvedValueOnce({
        status: 302,
        headers: { location: '/redirect' },
        data: '',
        config: {}
      } as any)
      .mockResolvedValueOnce({ status: 200, headers: {}, data: 'redirected' })

    const result = await utilHandlers['fetch-website']({} as any, [
      'https://github.com/start',
      { method: 'GET' }
    ])

    expect(result.data).toBe('redirected')
    expect(axiosMock).toHaveBeenCalledTimes(2)
    expect(isUrlSafeMock).toHaveBeenCalledTimes(2)
  })

  test('rejects redirects to disallowed targets', async () => {
    isUrlSafeMock.mockResolvedValueOnce(true)
    isUrlSafeMock.mockResolvedValueOnce(false)
    axiosMock.mockResolvedValueOnce({
      status: 301,
      headers: { location: 'http://127.0.0.1/internal' },
      data: '',
      config: {}
    } as any)

    await expect(
      utilHandlers['fetch-website']({} as any, ['https://github.com/start'])
    ).rejects.toThrow('Disallowed URL')
    expect(axiosMock).toHaveBeenCalledTimes(1)
  })
})
