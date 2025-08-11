import { jest } from '@jest/globals'

describe('preload sandbox', () => {
  test('exposes APIs in isolated context', async () => {
    const expose = jest.fn()
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
  })
})
