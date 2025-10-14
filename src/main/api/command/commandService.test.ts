import { EventEmitter } from 'events'
import path from 'node:path'
import * as childProcess from 'child_process'
import { CommandService } from './commandService'
import { CommandConfig } from './types'

const createMockChildProcess = () => {
  const child = new EventEmitter() as unknown as childProcess.ChildProcess
  const stdout = new EventEmitter() as unknown as NodeJS.ReadableStream
  const stderr = new EventEmitter() as unknown as NodeJS.ReadableStream
  const stdin = {
    write: jest.fn().mockReturnValue(true),
    end: jest.fn(),
    destroy: jest.fn()
  } as unknown as NodeJS.WritableStream

  Object.assign(child, {
    stdout,
    stderr,
    stdin,
    pid: 1234,
    spawnargs: ['echo', 'hello'],
    removeAllListeners: jest.fn().mockReturnValue(child),
    kill: jest.fn()
  })

  return { child, stdout, stderr, stdin }
}

describe('CommandService', () => {
  const cwd = process.cwd()
  const config: CommandConfig = {
    allowedCommands: [{ pattern: 'echo hello', description: 'echo hello' }],
    shell: '/bin/sh',
    allowedWorkingDirectories: [cwd],
    projectPath: cwd
  }
  let service: CommandService

  beforeEach(() => {
    service = new CommandService(config)
  })

  afterEach(() => {
    jest.restoreAllMocks()
    delete process.env.SAFE_KEY
    delete process.env.API_AUTH_TOKEN
  })

  test('rejects disallowed command', async () => {
    await expect(
      service.executeCommand({ command: 'ls', cwd })
    ).rejects.toMatchObject({ code: 'COMMAND_NOT_ALLOWED' })
  })

  test('rejects command with invalid characters', async () => {
    await expect(
      service.executeCommand({ command: 'echo hello; rm -rf /', cwd })
    ).rejects.toMatchObject({ code: 'COMMAND_ARGUMENT_INVALID_CHARACTERS' })
  })

  test('stopProcess terminates via process group on unix platforms', async () => {
    const pid = 123
    const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true)

    ;(service as any).runningProcesses.set(pid, {
      pid,
      command: 'test',
      timestamp: Date.now()
    })
    ;(service as any).processStates.set(pid, {
      isRunning: true,
      hasError: false,
      output: { stdout: '', stderr: '', code: null }
      // no process handle present
    })

    await service.stopProcess(pid)

    expect(killSpy).toHaveBeenCalledWith(-pid)
    killSpy.mockRestore()
  })

  test('stopProcess uses child process handle on windows platforms', async () => {
    const pid = 456
    const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true)
    const { child } = createMockChildProcess()
    ;(child.kill as jest.Mock).mockImplementation(() => {
      process.nextTick(() => (child as unknown as EventEmitter).emit('exit', 0))
      return true
    })

    ;(service as any).runningProcesses.set(pid, {
      pid,
      command: 'test',
      timestamp: Date.now()
    })
    ;(service as any).processStates.set(pid, {
      isRunning: true,
      hasError: false,
      output: { stdout: '', stderr: '', code: null },
      process: child
    })

    const original = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32' })

    await service.stopProcess(pid)

    expect(child.kill).toHaveBeenCalled()
    expect(killSpy).not.toHaveBeenCalledWith(-pid)

    Object.defineProperty(process, 'platform', { value: original })
    killSpy.mockRestore()
  })

  test('stopProcess treats missing processes as already terminated', async () => {
    const pid = 789
    const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => {
      const error = new Error('not found') as NodeJS.ErrnoException
      error.code = 'ESRCH'
      throw error
    })

    ;(service as any).runningProcesses.set(pid, {
      pid,
      command: 'test',
      timestamp: Date.now()
    })
    ;(service as any).processStates.set(pid, {
      isRunning: true,
      hasError: false,
      output: { stdout: '', stderr: '', code: null }
    })

    await expect(service.stopProcess(pid)).resolves.toBeUndefined()

    killSpy.mockRestore()
  })

  test('enforces concurrency limit', async () => {
    const limitedService = new CommandService({ ...config, maxConcurrentProcesses: 1 })
    ;(limitedService as any).runningProcesses.set(999, {
      pid: 999,
      command: 'echo hello',
      timestamp: Date.now()
    })

    await expect(
      limitedService.executeCommand({ command: 'echo hello', cwd })
    ).rejects.toMatchObject({ code: 'COMMAND_MAX_CONCURRENCY_REACHED' })
  })

  test('redacts failing working directory metadata', async () => {
    const restrictedService = new CommandService(config)

    await expect(
      restrictedService.executeCommand({ command: 'echo hello', cwd: path.join('..', 'secret') })
    ).rejects.toMatchObject({
      code: 'COMMAND_WORKDIR_RESOLUTION_FAILED',
      metadata: {
        receivedWorkingDirectory: {
          length: expect.any(Number),
          sha256: expect.any(String)
        }
      }
    })
  })

  test('constructs sanitized spawn environment', () => {
    process.env.SAFE_KEY = 'visible'
    process.env.API_AUTH_TOKEN = 'sensitive'

    const secureService = new CommandService({
      ...config,
      passthroughEnvKeys: ['SAFE_KEY', 'INVALID KEY'],
      additionalPathEntries: [path.join(cwd, 'bin')]
    })

    const env = (secureService as any).buildCommandEnvironment(false) as NodeJS.ProcessEnv

    expect(env).toBeDefined()
    expect(env.SAFE_KEY).toBe('visible')
    expect(env.API_AUTH_TOKEN).toBeUndefined()
    expect(env.PATH).toContain(path.join(cwd, 'bin'))
  })

  test('rejects stdin payloads that exceed configured limit', async () => {
    const limitedService = new CommandService({ ...config, maxStdinBytes: 1024 })
    const { child } = createMockChildProcess()

    ;(limitedService as any).runningProcesses.set(1, {
      pid: 1,
      command: 'echo hello',
      timestamp: Date.now()
    })
    ;(limitedService as any).processStates.set(1, {
      isRunning: true,
      hasError: false,
      output: { stdout: '', stderr: '', code: null },
      process: child
    })

    const oversized = 'A'.repeat(2 * 1024)
    await expect(
      limitedService.sendInput({ pid: 1, stdin: oversized })
    ).rejects.toMatchObject({ code: 'COMMAND_STDIN_LIMIT_EXCEEDED' })
  })
})
