import type { BrowserWindowConstructorOptions } from 'electron'

jest.mock('electron', () => {
  const mockLoadFile = jest.fn().mockResolvedValue(undefined)
  const mockShow = jest.fn()
  const mockOn = jest.fn()
  const mockClose = jest.fn()

  const mockBrowserWindow = jest
    .fn()
    .mockImplementation((_: BrowserWindowConstructorOptions) => ({
      loadURL: jest.fn().mockResolvedValue(undefined),
      loadFile: mockLoadFile,
      show: mockShow,
      close: mockClose,
      on: mockOn,
      isDestroyed: jest.fn().mockReturnValue(false)
    }))

  return {
    BrowserWindow: mockBrowserWindow,
    screen: {
      getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } })
    },
    __browserWindowMocks: {
      mockBrowserWindow,
      mockLoadFile,
      mockShow,
      mockOn,
      mockClose
    }
  }
})

const {
  __browserWindowMocks: { mockBrowserWindow }
} = jest.requireMock('electron') as {
  __browserWindowMocks: {
    mockBrowserWindow: jest.Mock
  }
}

jest.mock('../../../common/logger', () => ({
  log: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}))

import { cameraHandlers } from '../../../main/handlers/camera-handlers'

describe('camera preview window security', () => {
  beforeAll(() => {
    ;(process as any).resourcesPath = __dirname
  })

  beforeEach(() => {
    mockBrowserWindow.mockClear()
  })

  test('uses sandboxed renderer with isolation', async () => {
    const result = await cameraHandlers['camera:show-preview-window']({} as any, { cameraIds: ['default'] })
    expect(result.success).toBe(true)
    expect(mockBrowserWindow).toHaveBeenCalled()
    const opts = mockBrowserWindow.mock.calls[0][0]
    expect(opts.webPreferences?.sandbox).toBe(true)
    expect(opts.webPreferences?.nodeIntegration).toBe(false)
    expect(opts.webPreferences?.contextIsolation).toBe(true)
    expect(opts.webPreferences?.preload).toBeTruthy()
  })
})
