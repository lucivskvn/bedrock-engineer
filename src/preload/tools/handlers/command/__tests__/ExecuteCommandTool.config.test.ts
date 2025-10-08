import { ExecuteCommandTool } from '../ExecuteCommandTool'

jest.mock('../../../../helpers/agent-helpers', () => ({
  findAgentById: jest.fn().mockReturnValue(undefined)
}))

type StoreStub = {
  get: jest.Mock
  set: jest.Mock
  delete: jest.Mock
  clear: jest.Mock
}

const createStore = (values: Record<string, any> = {}): StoreStub => ({
  get: jest.fn((key: string) => values[key]),
  set: jest.fn((key: string, value: any) => {
    values[key] = value
  }),
  delete: jest.fn(),
  clear: jest.fn()
})

const createLogger = () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  verbose: jest.fn()
})

describe('ExecuteCommandTool configuration hardening', () => {
  const basePaths = {
    projectPath: '/tmp/project-root',
    userDataPath: '/tmp/user-data'
  }

  test('sanitizes concurrency, stdin, environment keys, and paths', () => {
    const store = createStore({
      ...basePaths,
      shell: '/bin/zsh',
      commandMaxConcurrentProcesses: 8,
      commandMaxStdinBytes: 999999,
      commandPassthroughEnvKeys: [' safe_key ', 'INVALID KEY', 'AWS_PROFILE', 123],
      commandSearchPaths: ['/usr/local/bin', ' ', '/usr/bin', '/usr/local/bin']
    })

    const tool = new ExecuteCommandTool({ logger: createLogger(), store } as any)
    const config = (tool as any).getCommandConfig()

    expect(config.maxConcurrentProcesses).toBe(4)
    expect(config.maxStdinBytes).toBe(262144)
    expect(config.passthroughEnvKeys).toEqual(['SAFE_KEY', 'AWS_PROFILE'])
    expect(config.additionalPathEntries).toEqual(['/usr/local/bin', '/usr/bin'])
  })

  test('treats non-positive concurrency configuration as unlimited', () => {
    const store = createStore({
      ...basePaths,
      commandMaxConcurrentProcesses: 0,
      commandMaxStdinBytes: 2048,
      commandPassthroughEnvKeys: [],
      commandSearchPaths: []
    })

    const tool = new ExecuteCommandTool({ logger: createLogger(), store } as any)
    const config = (tool as any).getCommandConfig()

    expect(config.maxConcurrentProcesses).toBeUndefined()
    expect(config.maxStdinBytes).toBe(2048)
  })
})
