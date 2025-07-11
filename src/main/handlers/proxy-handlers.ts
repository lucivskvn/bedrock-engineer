import { ipcMain } from 'electron'
import { testProxyConnection } from '../lib/proxy-utils'
import { updateProxySettings } from '../index'
import { log } from '../../common/logger'
import type { ProxyConfiguration } from '../api/bedrock/types'

/**
 * プロキシ関連のIPCハンドラーを登録
 */
export function registerProxyHandlers(): void {
  // プロキシ接続テスト
  ipcMain.handle('proxy:test-connection', async (_, proxyConfig: ProxyConfiguration) => {
    try {
      log.info('Testing proxy connection', { host: proxyConfig.host, port: proxyConfig.port })
      const result = await testProxyConnection(proxyConfig)
      return { success: true, connected: result }
    } catch (error) {
      log.error('Proxy connection test failed', {
        error: error instanceof Error ? error.message : String(error)
      })
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  // プロキシ設定更新（動的適用）
  ipcMain.handle('proxy:update-settings', async () => {
    try {
      log.info('Updating proxy settings')
      await updateProxySettings()
      return { success: true }
    } catch (error) {
      log.error('Proxy settings update failed', {
        error: error instanceof Error ? error.message : String(error)
      })
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  log.debug('Proxy IPC handlers registered')
}
