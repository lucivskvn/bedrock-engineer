import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { StrandsAgentsConverter } from '../StrandsAgentsConverter'
import type { ConfigStore } from '../../../../preload/store'
import type { StrandsAgentOutput } from '../types'

const createMockStore = (projectPath: string, userDataPath: string): ConfigStore => {
  return {
    get: (key: keyof any) => {
      if (key === 'projectPath') {
        return projectPath as any
      }
      if (key === 'userDataPath') {
        return userDataPath as any
      }
      return undefined as any
    },
    set: jest.fn()
  } as unknown as ConfigStore
}

const createOutput = (): StrandsAgentOutput => ({
  pythonCode: 'print("hello")',
  config: {
    name: 'Agent',
    description: 'Test agent',
    modelProvider: 'test-model',
    toolsUsed: [],
    unsupportedTools: [],
    environment: {}
  },
  toolMapping: {
    supportedTools: [],
    unsupportedTools: [],
    imports: new Set(),
    specialSetup: []
  },
  warnings: [],
  requirementsText: '# requirements',
  readmeText: '# README',
  configYamlText: 'version: 1'
})

describe('StrandsAgentsConverter.saveAgentToDirectory', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'strands-converter-'))
  const projectPath = path.join(tmpRoot, 'project')
  const userDataPath = path.join(tmpRoot, 'user-data')

  beforeAll(() => {
    fs.mkdirSync(projectPath, { recursive: true })
    fs.mkdirSync(userDataPath, { recursive: true })
  })

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('writes files only inside allowed directories', async () => {
    const converter = new StrandsAgentsConverter(createMockStore(projectPath, userDataPath))
    const outputDirectory = path.join(projectPath, 'exports')
    const result = await converter.saveAgentToDirectory(createOutput(), {
      outputDirectory,
      agentFileName: '../malicious.py',
      includeConfig: true,
      overwrite: true
    })

    expect(result.success).toBe(true)
    expect(result.outputDirectory).toBe(path.resolve(outputDirectory))
    expect(result.savedFiles.length).toBeGreaterThan(0)
    result.savedFiles.forEach((filePath) => {
      expect(filePath.startsWith(path.resolve(outputDirectory))).toBe(true)
    })

    const savedFiles = fs.readdirSync(outputDirectory)
    expect(savedFiles).toContain('malicious.py')
  })

  it('rejects directories outside the trusted allowlist', async () => {
    const converter = new StrandsAgentsConverter(createMockStore(projectPath, userDataPath))
    const forbiddenDirectory = path.join(process.cwd(), 'forbidden-output')

    const result = await converter.saveAgentToDirectory(createOutput(), {
      outputDirectory: forbiddenDirectory,
      overwrite: true
    })

    expect(result.success).toBe(false)
    expect(result.savedFiles).toHaveLength(0)
    expect(result.errors?.[0].error).toContain('Output path must reside within an allowed directory')
    expect(fs.existsSync(forbiddenDirectory)).toBe(false)
  })
})
