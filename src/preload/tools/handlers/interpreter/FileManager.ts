/**
 * Simplified File manager for CodeInterpreter
 * Handles basic workspace operations only
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import { WorkspaceConfig } from './types'
import { ToolLogger } from '../../base/types'
import { createStructuredError } from '../../../../common/errors'
import { SecurityManager } from './SecurityManager'

/**
 * Simplified file information
 */
interface FileInfo {
  name: string
  type: 'file' | 'directory'
  size?: number
  modified?: Date
}

/**
 * Simplified file operation result
 */
interface FileListResult {
  listedFiles?: FileInfo[]
}

/**
 * Simplified File manager class
 */
export class FileManager {
  private logger: ToolLogger
  private config: WorkspaceConfig
  private workspacePath?: string

  constructor(logger: ToolLogger, _securityManager: SecurityManager, config: WorkspaceConfig) {
    this.logger = logger
    this.config = config
  }

  /**
   * Generate date string for workspace folder names
   * Format: YYYYMMDD
   */
  private generateDateString(): string {
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')

    return `${year}${month}${day}`
  }

  /**
   * Initialize workspace directory under .bedrock-engineer/workspaces/
   */
  async initializeWorkspace(): Promise<void> {
    try {
      // Create .bedrock-engineer/workspaces directory if it doesn't exist
      const bedrockEngineerDir = path.join(this.config.basePath, '.bedrock-engineer')
      const workspacesDir = path.join(bedrockEngineerDir, 'workspaces')

      await fs.mkdir(workspacesDir, { recursive: true })

      // Create session-specific workspace directory with date and session ID
      const dateString = this.generateDateString()
      const sessionWorkspaceDir = path.join(
        workspacesDir,
        `workspace-${dateString}-${this.config.sessionId}`
      )
      await fs.mkdir(sessionWorkspaceDir, { recursive: true })

      this.workspacePath = sessionWorkspaceDir

      this.logger.debug('Workspace initialized', {
        path: this.workspacePath,
        sessionId: this.config.sessionId,
        bedrockEngineerDir,
        workspacesDir
      })
    } catch (error) {
      this.logger.error('Failed to initialize workspace', {
        error: error instanceof Error ? error.message : String(error)
      })
      throw createStructuredError({
        name: 'CodeInterpreterWorkspaceError',
        message: 'Failed to initialize workspace.',
        code: 'WORKSPACE_INITIALIZATION_FAILED',
        metadata: {
          errorMessage: error instanceof Error ? error.message : String(error)
        }
      })
    }
  }

  /**
   * Get workspace path
   */
  getWorkspacePath(): string {
    if (!this.workspacePath) {
      throw createStructuredError({
        name: 'CodeInterpreterWorkspaceError',
        message: 'Workspace not initialized.',
        code: 'WORKSPACE_NOT_INITIALIZED'
      })
    }
    return this.workspacePath
  }

  /**
   * List files in workspace
   */
  async listFiles(): Promise<FileListResult> {
    try {
      const workspacePath = this.getWorkspacePath()
      const entries = await fs.readdir(workspacePath, { withFileTypes: true })

      const listedFiles: FileInfo[] = []

      for (const entry of entries) {
        try {
          const stats = await fs.stat(path.join(workspacePath, entry.name))
          listedFiles.push({
            name: entry.name,
            type: entry.isDirectory() ? 'directory' : 'file',
            size: entry.isFile() ? stats.size : undefined,
            modified: stats.mtime
          })
        } catch (error) {
          this.logger.warn('Failed to get file stats', {
            filename: entry.name,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }

      this.logger.debug('Files listed', {
        workspacePath,
        fileCount: listedFiles.length
      })

      return { listedFiles }
    } catch (error) {
      this.logger.error('Failed to list files', {
        error: error instanceof Error ? error.message : String(error)
      })
      return { listedFiles: [] }
    }
  }

  /**
   * Clean up workspace
   */
  async cleanup(): Promise<void> {
    if (!this.workspacePath) {
      return // Nothing to clean up
    }

    try {
      await fs.rm(this.workspacePath, { recursive: true, force: true })

      this.logger.debug('Workspace cleaned up', {
        path: this.workspacePath,
        sessionId: this.config.sessionId
      })

      this.workspacePath = undefined
    } catch (error) {
      this.logger.warn('Failed to cleanup workspace', {
        path: this.workspacePath,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  /**
   * Clean up old workspaces (older than specified hours)
   */
  async cleanupOldWorkspaces(olderThanHours: number = 24): Promise<void> {
    try {
      const workspacesDir = path.join(this.config.basePath, '.bedrock-engineer', 'workspaces')

      // Check if workspaces directory exists
      try {
        await fs.access(workspacesDir)
      } catch {
        return // Directory doesn't exist, nothing to clean
      }

      const entries = await fs.readdir(workspacesDir, { withFileTypes: true })
      const cutoffTime = Date.now() - olderThanHours * 60 * 60 * 1000
      let cleanedCount = 0

      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith('workspace-')) {
          const workspacePath = path.join(workspacesDir, entry.name)

          try {
            const stats = await fs.stat(workspacePath)

            // Clean up if older than cutoff time and not the current workspace
            if (stats.mtime.getTime() < cutoffTime && workspacePath !== this.workspacePath) {
              await fs.rm(workspacePath, { recursive: true, force: true })
              cleanedCount++

              this.logger.debug('Old workspace cleaned up', {
                path: workspacePath,
                age: Date.now() - stats.mtime.getTime()
              })
            }
          } catch (error) {
            this.logger.warn('Failed to clean up old workspace', {
              path: workspacePath,
              error: error instanceof Error ? error.message : String(error)
            })
          }
        }
      }

      if (cleanedCount > 0) {
        this.logger.info('Old workspaces cleanup completed', {
          cleanedCount,
          olderThanHours
        })
      }
    } catch (error) {
      this.logger.warn('Failed to cleanup old workspaces', {
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }
}
