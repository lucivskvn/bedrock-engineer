import { IpcMainInvokeEvent, app } from 'electron'
import { handleFileOpen } from '../../preload/file'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { log } from '../../common/logger'
import { store } from '../../preload/store'
import {
  buildAllowedOutputDirectories,
  ensureDirectoryWithinAllowed,
  ensurePathWithinAllowedDirectories,
  sanitizeFilename
} from '../security/path-utils'
import { toFileToken } from '../../common/security/pathTokens'

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const ALLOWED_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp'])

function hasErrorCause(error: unknown): error is Error & { cause?: unknown } {
  return error instanceof Error && 'cause' in error && (error as { cause?: unknown }).cause !== undefined
}

function getPathContext(): {
  projectPath?: string
  userDataPath?: string
} {
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

  return { projectPath, userDataPath }
}

function getAllowedFileReadDirectories(): string[] {
  const { projectPath, userDataPath } = getPathContext()

  return buildAllowedOutputDirectories({
    projectPath,
    userDataPath,
    additional: [
      app.getPath('downloads'),
      path.join(app.getPath('downloads'), 'bedrock-engineer'),
      app.getPath('documents'),
      app.getPath('pictures'),
      app.getPath('videos'),
      app.getPath('desktop'),
      os.tmpdir()
    ]
  })
}

function resolveReadableFilePath(filePath: string): string {
  const { projectPath } = getPathContext()
  const allowedDirectories = getAllowedFileReadDirectories()
  const candidatePath = path.isAbsolute(filePath)
    ? filePath
    : projectPath
    ? path.resolve(projectPath, filePath)
    : path.resolve(filePath)

  return ensurePathWithinAllowedDirectories(candidatePath, allowedDirectories)
}

export const fileHandlers = {
  'open-file': async (_event: IpcMainInvokeEvent) => {
    return handleFileOpen({
      title: 'openFile...',
      properties: ['openFile']
    })
  },

  'open-directory': async (_event: IpcMainInvokeEvent) => {
    const path = await handleFileOpen({
      title: 'Select Directory',
      properties: ['openDirectory', 'createDirectory'],
      message: 'Select a directory for your project',
      buttonLabel: 'Select Directory'
    })

    // If path was selected and it differs from the current project path,
    // update the project path in store
    if (path) {
      if (path !== store.get('projectPath')) {
        store.set('projectPath', path)
        log.info('Project path changed', { newPath: toFileToken(path) })
      }
    }

    return path
  },

  'get-local-image': async (_event: IpcMainInvokeEvent, filePath: string) => {
    let fileNameToken = toFileToken(filePath)

    try {
      const resolvedPath = resolveReadableFilePath(filePath)
      fileNameToken = toFileToken(resolvedPath)
      const extension = path.extname(resolvedPath).toLowerCase()

      if (!ALLOWED_IMAGE_EXTENSIONS.has(extension)) {
        throw new Error('Unsupported image extension.', {
          cause: {
            fileName: fileNameToken,
            extension: extension || '[unknown]'
          }
        })
      }

      const stats = await fs.promises.stat(resolvedPath)
      if (stats.size > MAX_IMAGE_BYTES) {
        throw new Error('Image file exceeds maximum allowed size.', {
          cause: {
            fileName: fileNameToken,
            fileSize: stats.size,
            maxBytes: MAX_IMAGE_BYTES
          }
        })
      }

      const data = await fs.promises.readFile(resolvedPath)
      const ext = extension.slice(1) || 'png'
      const base64 = data.toString('base64')
      return `data:image/${ext};base64,${base64}`
    } catch (error) {
      log.error('Failed to read image', {
        fileName: fileNameToken,
        error: error instanceof Error ? error.message : String(error)
      })

      if (hasErrorCause(error)) {
        throw error
      }

      throw new Error('Failed to load local image.', {
        cause: {
          fileName: fileNameToken,
          reason: error instanceof Error ? error.message : String(error)
        }
      })
    }
  },

  'read-project-ignore': async (
    _event: IpcMainInvokeEvent,
    { projectPath }: { projectPath: string }
  ) => {
    try {
      const ignoreFilePath = path.join(projectPath, '.bedrock-engineer', '.ignore')

      try {
        const content = await fs.promises.readFile(ignoreFilePath, 'utf-8')
        log.info('Project ignore file read successfully', {
          projectPath: toFileToken(projectPath),
          ignoreFilePath: toFileToken(ignoreFilePath)
        })
        return { content, exists: true }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          // ファイルが存在しない場合は空の内容を返す
          log.info('Project ignore file does not exist', {
            projectPath: toFileToken(projectPath),
            ignoreFilePath: toFileToken(ignoreFilePath)
          })
          return { content: '', exists: false }
        }
        throw error
      }
    } catch (error) {
      log.error('Failed to read project ignore file', {
        projectPath: toFileToken(projectPath),
        error: error instanceof Error ? error.message : String(error)
      })
      throw error
    }
  },

  'write-project-ignore': async (
    _event: IpcMainInvokeEvent,
    { projectPath, content }: { projectPath: string; content: string }
  ) => {
    try {
      const bedrockEngineerDir = path.join(projectPath, '.bedrock-engineer')
      const ignoreFilePath = path.join(bedrockEngineerDir, '.ignore')

      // .bedrock-engineerディレクトリが存在しない場合は作成
      try {
        await fs.promises.access(bedrockEngineerDir)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          await fs.promises.mkdir(bedrockEngineerDir, { recursive: true })
          log.info('Created .bedrock-engineer directory', {
            bedrockEngineerDir: toFileToken(bedrockEngineerDir)
          })
        } else {
          throw error
        }
      }

      // .ignoreファイルを書き込み
      await fs.promises.writeFile(ignoreFilePath, content, 'utf-8')
      log.info('Project ignore file written successfully', {
        projectPath: toFileToken(projectPath),
        ignoreFilePath: toFileToken(ignoreFilePath)
      })

      return { success: true }
    } catch (error) {
      log.error('Failed to write project ignore file', {
        projectPath: toFileToken(projectPath),
        error: error instanceof Error ? error.message : String(error)
      })
      return { success: false }
    }
  },

  'save-website-content': async (
    _event: IpcMainInvokeEvent,
    {
      content,
      url,
      filename,
      directory,
      format
    }: {
      content: string
      url: string
      filename?: string
      directory?: string
      format: 'html' | 'txt'
    }
  ) => {
    const requestedDirectoryToken = directory ? toFileToken(directory) : undefined

    try {
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

      const defaultDirectory = projectPath
        ? path.join(projectPath, 'downloads')
        : path.join(app.getPath('downloads'), 'bedrock-engineer')

      const allowedDirectories = buildAllowedOutputDirectories({
        projectPath,
        userDataPath,
        additional: [
          defaultDirectory,
          app.getPath('downloads'),
          app.getPath('documents'),
          app.getPath('pictures'),
          app.getPath('videos'),
          os.tmpdir()
        ]
      })

      const targetDirectoryCandidate = directory ?? defaultDirectory
      const targetDirectory = ensureDirectoryWithinAllowed(targetDirectoryCandidate, allowedDirectories)

      await fs.promises.mkdir(targetDirectory, { recursive: true, mode: 0o700 })

      const extension = format === 'html' ? '.html' : '.txt'
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

      let fallbackBase = `website_${timestamp}`
      try {
        const parsedUrl = new URL(url)
        const domain = parsedUrl.hostname.replace(/^www\./, '')
        if (domain) {
          fallbackBase = `${domain}_${timestamp}`
        }
      } catch {
        // ignore invalid URLs and keep fallback
      }

      const safeFilename = sanitizeFilename(filename, {
        fallback: fallbackBase,
        allowedExtensions: [extension]
      })

      const filePath = ensurePathWithinAllowedDirectories(
        path.join(targetDirectory, safeFilename),
        allowedDirectories
      )

      // ファイル名の重複を避ける
      let finalPath = filePath
      let counter = 1
      let fileExists = true
      while (fileExists) {
        try {
          await fs.promises.access(finalPath)
          // ファイルが存在する場合、番号を付けて再試行
          const extname = path.extname(safeFilename)
          const basename = path.basename(safeFilename, extname)
          const newFilename = sanitizeFilename(`${basename}_${counter}`, {
            fallback: `${basename}_${counter}`,
            allowedExtensions: [extension]
          })
          finalPath = ensurePathWithinAllowedDirectories(
            path.join(targetDirectory, newFilename),
            allowedDirectories
          )
          counter++
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            // ファイルが存在しない場合は使用可能
            fileExists = false
          } else {
            throw error
          }
        }
      }

      // ファイルを保存
      await fs.promises.writeFile(finalPath, content, 'utf-8')

      const finalPathToken = toFileToken(finalPath)
      const targetDirectoryToken = toFileToken(targetDirectory)

      log.info('Website content saved successfully', {
        url,
        filePath: finalPathToken,
        targetDirectory: targetDirectoryToken,
        format,
        fileSize: content.length
      })

      return {
        success: true,
        filePath: finalPath
      }
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'UnknownError'
      const rawErrorMessage = error instanceof Error ? error.message : String(error)
      const errorMessage =
        rawErrorMessage.length > 200 ? `${rawErrorMessage.slice(0, 200)}...` : rawErrorMessage

      log.error('Failed to save website content', {
        url,
        filename,
        directory: requestedDirectoryToken,
        format,
        errorName,
        errorMessage
      })

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }
} as const
