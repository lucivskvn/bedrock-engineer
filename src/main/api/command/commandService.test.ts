import { CommandService } from './commandService'
import { CommandConfig } from './types'
const childProcess = require('child_process')

describe('CommandService', () => {
  const cwd = process.cwd()
  const config: CommandConfig = {
    allowedCommands: [{ pattern: 'echo hello', description: 'echo hello' }],
    shell: '/bin/sh'
  }
  let service: CommandService

  beforeEach(() => {
    service = new CommandService(config)
  })

  test('rejects disallowed command', async () => {
    await expect(
      service.executeCommand({ command: 'ls', cwd })
    ).rejects.toThrow('Command not allowed')
  })

  test('rejects command with invalid characters', async () => {
    await expect(
      service.executeCommand({ command: 'echo hello; rm -rf /', cwd })
    ).rejects.toThrow('Invalid characters')
  })

  test('stopProcess kills process on unix platforms', async () => {
    const pid = 123
    const mockKill = jest.fn()

    ;(service as any).runningProcesses.set(pid, {
      pid,
      command: 'test',
      timestamp: Date.now()
    })
    ;(service as any).processStates.set(pid, {
      isRunning: true,
      hasError: false,
      output: { stdout: '', stderr: '', code: null },
      process: { kill: mockKill }
    })

    const original = process.platform
    Object.defineProperty(process, 'platform', { value: 'linux' })
    await service.stopProcess(pid)
    expect(mockKill).toHaveBeenCalled()
    Object.defineProperty(process, 'platform', { value: original })
  })

  test('stopProcess uses taskkill on windows platforms', async () => {
    const pid = 456
    const mockKill = jest.fn()

    ;(service as any).runningProcesses.set(pid, {
      pid,
      command: 'test',
      timestamp: Date.now()
    })
    ;(service as any).processStates.set(pid, {
      isRunning: true,
      hasError: false,
      output: { stdout: '', stderr: '', code: null },
      process: { kill: mockKill }
    })

    const originalSpawn = childProcess.spawn
    ;(childProcess as any).spawn = jest.fn().mockReturnValue({})
    const original = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32' })

    await service.stopProcess(pid)

    expect((childProcess.spawn as jest.Mock).mock.calls[0][0]).toBe('taskkill')
    expect((childProcess.spawn as jest.Mock).mock.calls[0][1]).toEqual([
      '/pid',
      pid.toString(),
      '/t',
      '/f'
    ])
    expect(mockKill).not.toHaveBeenCalled()

    ;(childProcess as any).spawn = originalSpawn
    Object.defineProperty(process, 'platform', { value: original })
  })
})
