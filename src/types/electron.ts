import { Tool } from '@aws-sdk/client-bedrock-runtime'
import { ElectronAPI } from '@electron-toolkit/preload'
import { chatHistory } from '../preload/chat-history'
// Minimal store interface to avoid importing preload store in type definitions
interface ConfigStore {
  get(key: string): any
  set(key: string, value: any): void
}
import { file } from '../preload/file'
import { API } from '../preload/api'
import { RendererLogger, RendererCategoryLogger } from '../preload/logger'
import { ipcClient } from '../preload/ipc-client'

declare global {
  interface Window {
    electron: ElectronAPI
    api: API
    store: ConfigStore
    file: typeof file
    tools: Tool[]
    chatHistory: typeof chatHistory
    appWindow: {
      isFocused: () => Promise<boolean>
    }
    ipc: typeof ipcClient
    logger: {
      log: RendererLogger
      createCategoryLogger: (category: string) => RendererCategoryLogger
    }
  }
}
