import fs from 'fs'
import path from 'path'
import os from 'os'
import { execSync } from 'child_process'
import { store } from '../store'

/**
 * コマンド実行可能ファイルのパスを解決する
 * Windowsのパス検索やユーザー設定から追加されたPATHに対応
 * @param command コマンド名（uvx など）
 * @returns 解決されたコマンドパス
 */
export function resolveCommand(command: string): string {
  try {
    const isWindows = process.platform === 'win32'

    // 設定で追加されたPATHを取得
    const additionalPaths =
      (store.get('commandSearchPaths') as string[] | undefined) || []

    // 1. 絶対パスの場合はそのまま使用 (Windowsでは拡張子も考慮)
    if (path.isAbsolute(command)) {
      if (fs.existsSync(command)) {
        return command
      }
      if (isWindows) {
        const resolved = tryExtensions(command)
        if (resolved) {
          return resolved
        }
      }
    }

    // 2. 一般的なインストール先を確認
    const commonPaths = isWindows
      ? [
          'C:/Program Files/nodejs',
          'C:/Program Files/Git/cmd',
          'C:/Program Files/Amazon/AWSCLIV2',
          path.join(os.homedir(), 'AppData/Local/Microsoft/WindowsApps')
        ]
      : [
          '/usr/local/bin',
          '/opt/homebrew/bin',
          // Apple Silicon Mac用のHomebrew
          '/opt/homebrew/bin',
          // Intel Mac用のHomebrew
          '/usr/local/bin',
          // ユーザーのホームディレクトリ内のbin
          path.join(os.homedir(), '.npm-global/bin'),
          path.join(os.homedir(), 'bin'),
          path.join(os.homedir(), '.local/bin')
        ]

    const envPaths = process.env.PATH ? process.env.PATH.split(path.delimiter) : []
    const searchPaths = [...additionalPaths, ...commonPaths, ...envPaths]

    for (const dir of searchPaths) {
      try {
        const fullPath = path.join(dir, command)
        if (fs.existsSync(fullPath)) {
          return fullPath
        }
        if (isWindows) {
          const winPath = tryExtensions(fullPath)
          if (winPath) {
            return winPath
          }
        }
      } catch {
        // エラーを無視して次のパスを試行
      }
    }

    // 3. OS固有の探索コマンドで検索
    if (isWindows) {
      try {
        const wherePath = execSync(`where ${command}`, { encoding: 'utf8' })
          .split('\n')[0]
          .trim()
        if (wherePath && fs.existsSync(wherePath)) {
          return wherePath
        }
      } catch {
        // whereコマンドが失敗した場合は無視
      }
    } else {
      try {
        const whichPath = execSync(`which ${command}`, { encoding: 'utf8' }).trim()
        if (whichPath && fs.existsSync(whichPath)) {
          return whichPath
        }
      } catch {
        // whichコマンドが失敗した場合は無視
      }
    }
  } catch (error) {
    console.error(`Error resolving command path for ${command}:`, error)
  }

  // 最終的には元のコマンド名を返す
  return command
}

function tryExtensions(basePath: string): string | undefined {
  const exts = (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM')
    .split(';')
    .map((e) => e.toLowerCase())

  for (const ext of exts) {
    const target = basePath.endsWith(ext.toLowerCase()) ? basePath : basePath + ext
    if (fs.existsSync(target)) {
      return target
    }
  }
  return undefined
}
