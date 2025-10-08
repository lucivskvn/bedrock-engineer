import fs from 'node:fs/promises'
import path from 'node:path'
import { ensurePathWithinAllowedDirectories } from './pathGuards'

export const MAX_AGENT_FILE_BYTES = 256 * 1024

function normalizeAllowedDirectory(directory: string): string {
  return path.resolve(directory)
}

export async function readAgentFileSafely(
  candidatePath: string,
  agentsDirectory: string
): Promise<string> {
  const normalizedDir = normalizeAllowedDirectory(agentsDirectory)
  const safePath = ensurePathWithinAllowedDirectories(candidatePath, [normalizedDir])
  const stats = await fs.lstat(safePath)

  if (stats.isSymbolicLink()) {
    throw new Error('Agent file cannot be a symbolic link')
  }

  if (!stats.isFile()) {
    throw new Error('Agent entry must be a regular file')
  }

  if (stats.size > MAX_AGENT_FILE_BYTES) {
    throw new Error('Agent file exceeds the maximum supported size')
  }

  return fs.readFile(safePath, 'utf-8')
}
