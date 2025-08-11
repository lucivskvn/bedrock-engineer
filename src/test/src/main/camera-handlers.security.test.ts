import type { BrowserWindowConstructorOptions } from 'electron'

const loadFileMock = jest.fn().mockResolvedValue(undefined)
const showMock = jest.fn()
const onMock = jest.fn()
const closeMock = jest.fn()

const BrowserWindowMock = jest.fn().mockImplementation((_: BrowserWindowConstructorOptions) => ({
  loadURL: jest.fn().mockResolvedValue(undefined),
  loadFile: loadFileMock,
  show: showMock,
  close: closeMock,
  on: onMock,
  isDestroyed: jest.fn().mockReturnValue(false)
}))

jest.mock('electron', () => ({
  BrowserWindow: BrowserWindowMock,
  screen: {
    getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } })
  }
}))

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
    BrowserWindowMock.mockClear()
  })

  test('uses sandboxed renderer with isolation', async () => {
    const result = await cameraHandlers['camera:show-preview-window']({} as any, { cameraIds: ['default'] })
    expect(result.success).toBe(true)
    expect(BrowserWindowMock).toHaveBeenCalled()
    const opts = BrowserWindowMock.mock.calls[0][0]
    expect(opts.webPreferences?.sandbox).toBe(true)
    expect(opts.webPreferences?.nodeIntegration).toBe(false)
    expect(opts.webPreferences?.contextIsolation).toBe(true)
    expect(opts.webPreferences?.preload).toBeTruthy()
  })
})
