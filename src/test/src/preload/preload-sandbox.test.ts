import { jest } from '@jest/globals'

describe('preload sandbox', () => {
  test.skip('exposes APIs in isolated context', async () => {
    const windowMock: any = {}
    ;(global as any).window = windowMock
    const expose = jest.fn((key: string, value: unknown) => {
      windowMock[key] = value
    })
    const originalContext = (process as any).contextIsolated

    await jest.isolateModulesAsync(async () => {
      ;(process as any).contextIsolated = true
      jest.doMock('electron', () => ({
        contextBridge: { exposeInMainWorld: expose },
        ipcRenderer: { on: jest.fn(), send: jest.fn() }
      }))
      jest.doMock('@electron-toolkit/preload', () => ({ electronAPI: {} }))
      jest.doMock('../../../preload/api', () => ({ api: {} }))
      jest.doMock('../../../preload/store', () => ({ store: {} }))
      jest.doMock('../../../preload/file', () => ({ file: {} }))
      jest.doMock('../../../preload/chat-history', () => ({ chatHistory: {} }))
      jest.doMock('../../../preload/appWindow', () => ({ appWindow: {} }))
      jest.doMock('../../../preload/logger', () => ({
        rendererLogger: {},
        createRendererCategoryLogger: () => ({ info: jest.fn(), error: jest.fn(), debug: jest.fn() })
      }))
      jest.doMock('../../../preload/ipc-client', () => ({ ipcClient: {} }))
      jest.doMock('../../../preload/tools', () => ({ executeTool: jest.fn() }))
      jest.doMock('../../../preload/tools/registry', () => ({ ToolMetadataCollector: { getToolSpecs: jest.fn() } }))
      // eslint-disable-next-line no-restricted-syntax -- preload index must be imported after mocks are registered
      await import('../../../preload/index')
    })

    ;(process as any).contextIsolated = originalContext

    expect(expose).toHaveBeenCalled()
    const exposedKeys = expose.mock.calls.map((call) => call[0])
    expect(exposedKeys).toEqual(
      expect.arrayContaining([
        'electron',
        'api',
        'store',
        'file',
        'chatHistory',
        'appWindow',
        'ipc',
        'logger',
        'preloadTools'
      ])
    )
    expect(windowMock.process).toBeUndefined()
    expect(windowMock.require).toBeUndefined()
    delete (global as any).window
  })
})
