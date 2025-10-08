import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { mkdtempSync } from 'node:fs'
import { readAgentFileSafely, MAX_AGENT_FILE_BYTES } from '../agentGuards'

const tmpRoot = path.join(os.tmpdir(), 'agent-guards-test-')

function createTempDir(): string {
  return mkdtempSync(tmpRoot)
}

describe('readAgentFileSafely', () => {
  it('reads a file within the allowed directory', async () => {
    const dir = createTempDir()
    const filePath = path.join(dir, 'agent.yaml')
    await fs.writeFile(filePath, 'name: test', 'utf-8')

    await expect(readAgentFileSafely(filePath, dir)).resolves.toBe('name: test')
  })

  it('rejects files outside of the allowed directory', async () => {
    const dir = createTempDir()
    const outsideDir = createTempDir()
    const outsideFile = path.join(outsideDir, 'agent.yaml')
    await fs.writeFile(outsideFile, 'name: evil', 'utf-8')

    await expect(readAgentFileSafely(outsideFile, dir)).rejects.toThrow('allowed directory')
  })

  it('rejects symbolic links even if they point inside', async () => {
    const dir = createTempDir()
    const target = path.join(dir, 'real.yaml')
    await fs.writeFile(target, 'name: link', 'utf-8')
    const link = path.join(dir, 'link.yaml')
    await fs.symlink(target, link)

    await expect(readAgentFileSafely(link, dir)).rejects.toThrow('symbolic link')
  })

  it('rejects files that exceed the size limit', async () => {
    const dir = createTempDir()
    const file = path.join(dir, 'large.yaml')
    const largeBuffer = Buffer.alloc(MAX_AGENT_FILE_BYTES + 1, 'a')
    await fs.writeFile(file, largeBuffer)

    await expect(readAgentFileSafely(file, dir)).rejects.toThrow('exceeds the maximum supported size')
  })
})
