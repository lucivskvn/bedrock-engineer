import { IpcMainInvokeEvent, desktopCapturer, app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { promisify } from 'util'
import { log } from '../../common/logger'
import { store } from '../../preload/store'
import { buildAllowedOutputDirectories, resolveSafeOutputPath } from '../security/path-utils'
import { toFileToken } from '../../common/security/pathTokens'

const writeFile = promisify(fs.writeFile)
const stat = promisify(fs.stat)

function hasErrorCause(error: unknown): error is Error & { cause?: unknown } {
  return error instanceof Error && 'cause' in error && (error as { cause?: unknown }).cause !== undefined
}

function getAllowedCaptureDirectories(): string[] {
  const projectPathValue = store.get('projectPath')
  const projectPath =
    typeof projectPathValue === 'string' && projectPathValue.trim().length > 0
      ? projectPathValue
      : undefined
  const userDataPathValue = store.get('userDataPath')
  const userDataPath =
    typeof userDataPathValue === 'string' && userDataPathValue.trim().length > 0
      ? userDataPathValue
      : undefined

  return buildAllowedOutputDirectories({
    projectPath,
    userDataPath,
    additional: [
      path.join(app.getPath('pictures'), 'bedrock-engineer'),
      path.join(app.getPath('downloads'), 'bedrock-engineer'),
      app.getPath('pictures'),
      app.getPath('downloads'),
      app.getPath('documents'),
      app.getPath('videos'),
      os.tmpdir()
    ]
  })
}

interface ScreenCaptureOptions {
  format?: 'png' | 'jpeg'
  quality?: number
  outputPath?: string
  windowTarget?: string
}

interface ScreenCaptureResult {
  success: boolean
  filePath: string
  metadata: {
    width: number
    height: number
    format: string
    fileSize: number
    timestamp: string
  }
}

interface PermissionCheckResult {
  hasPermission: boolean
  platform: string
  message: string
}

interface WindowInfo {
  id: string
  name: string
  enabled: boolean
  thumbnail: string // base64画像データ
  dimensions: { width: number; height: number } // 実際のウィンドウサイズ
}

export const screenHandlers = {
  'screen:capture': async (
    _event: IpcMainInvokeEvent,
    options: ScreenCaptureOptions = {}
  ): Promise<ScreenCaptureResult> => {
    try {
      log.info('Starting screen capture', {
        format: options.format || 'png',
        quality: options.quality,
        hasWindowTarget: !!options.windowTarget
      })

      let image: Electron.NativeImage

      // ウィンドウ指定がある場合
      if (options.windowTarget) {
        // ウィンドウソースを取得
        const windowSources = await desktopCapturer.getSources({
          types: ['window'],
          thumbnailSize: { width: 1920, height: 1080 }
        })

        if (windowSources.length === 0) {
          throw new Error('No window sources available')
        }

        // 指定されたウィンドウを検索
        const targetWindow = windowSources.find((source) =>
          source.name.toLowerCase().includes(options.windowTarget!.toLowerCase())
        )

        if (!targetWindow) {
          throw new Error('Requested capture window was not found.', {
            cause: {
              target: options.windowTarget,
              availableWindowCount: windowSources.length
            }
          })
        }

        image = targetWindow.thumbnail
        log.info('Capturing specific window', { windowName: targetWindow.name })
      } else {
        // 全画面キャプチャ
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: 1920, height: 1080 }
        })

        if (sources.length === 0) {
          throw new Error('No screen sources available')
        }

        // プライマリスクリーンを使用
        const primarySource = sources[0]
        image = primarySource.thumbnail
      }

      // 出力パスの決定
      const timestamp = Date.now()
      const format = options.format || 'png'

      const allowedDirectories = getAllowedCaptureDirectories()
      const defaultDirectory = path.join(app.getPath('pictures'), 'bedrock-engineer')
      const { fullPath: outputPath } = resolveSafeOutputPath({
        requestedPath: options.outputPath,
        defaultDirectory,
        defaultFileName: `screenshot_${timestamp}`,
        allowedDirectories,
        extension: `.${format}`
      })

      await fs.promises.mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 })

      // 画像の保存
      let buffer: Buffer
      if (format === 'jpeg') {
        buffer = image.toJPEG(options.quality || 80)
      } else {
        buffer = image.toPNG()
      }

      await writeFile(outputPath, new Uint8Array(buffer))

      // ファイル情報の取得
      const stats = await stat(outputPath)
      const size = image.getSize()

      log.info('Screenshot captured successfully', {
        fileName: toFileToken(outputPath),
        width: size.width,
        height: size.height,
        format,
        fileSize: stats.size
      })

      return {
        success: true,
        filePath: outputPath,
        metadata: {
          width: size.width,
          height: size.height,
          format,
          fileSize: stats.size,
          timestamp: new Date().toISOString()
        }
      }
    } catch (error) {
      log.error('Failed to capture screen', {
        error: error instanceof Error ? error.message : String(error)
      })

      if (hasErrorCause(error)) {
        throw error
      }

      throw new Error('Failed to capture screen.', {
        cause: {
          reason: error instanceof Error ? error.message : String(error)
        }
      })
    }
  },

  'screen:list-available-windows': async (_event: IpcMainInvokeEvent): Promise<WindowInfo[]> => {
    try {
      log.debug('Listing available windows')

      const windowSources = await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: { width: 300, height: 200 } // プレビュー用の適切なサイズ
      })

      const windowInfos: WindowInfo[] = windowSources.map((source, _index) => {
        // サムネイル画像をbase64形式で取得
        const thumbnailBuffer = source.thumbnail.toPNG()
        const thumbnailBase64 = `data:image/png;base64,${thumbnailBuffer.toString('base64')}`

        // サムネイルのサイズを取得
        const thumbnailSize = source.thumbnail.getSize()

        return {
          id: source.id,
          name: source.name,
          enabled: false, // Default to disabled
          thumbnail: thumbnailBase64,
          dimensions: {
            width: thumbnailSize.width,
            height: thumbnailSize.height
          }
        }
      })

      log.info('Found available windows with thumbnails', { count: windowInfos.length })
      return windowInfos
    } catch (error) {
      log.error('Failed to list available windows', {
        error: error instanceof Error ? error.message : String(error)
      })
      return []
    }
  },

  'screen:check-permissions': async (
    _event: IpcMainInvokeEvent
  ): Promise<PermissionCheckResult> => {
    try {
      log.debug('Checking screen capture permissions')

      // macOSでの権限確認
      if (process.platform === 'darwin') {
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: 1, height: 1 }
        })

        const hasPermission = sources.length > 0
        const message = hasPermission
          ? 'Screen recording permission granted'
          : 'Screen recording permission required. Please enable in System Preferences > Security & Privacy > Privacy > Screen Recording.'

        log.info('macOS screen permission check', { hasPermission })

        return {
          hasPermission,
          platform: 'darwin',
          message
        }
      }

      // その他のプラットフォーム
      log.debug('Non-macOS platform, no special permissions required')
      return {
        hasPermission: true,
        platform: process.platform,
        message: 'No special permissions required'
      }
    } catch (error) {
      log.error('Permission check failed', {
        error: error instanceof Error ? error.message : String(error)
      })
      return {
        hasPermission: false,
        platform: process.platform,
        message: error instanceof Error ? error.message : 'Permission check failed'
      }
    }
  }
} as const
