import { CommandService } from './commandService'
import { CommandConfig } from './types'

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

  test('stopProcess kills the process group on unix platforms', async () => {
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
      // no process object needed for this test
    })

    await service.stopProcess(pid)

    expect(killSpy).toHaveBeenCalledWith(-pid)
    killSpy.mockRestore()
  })

  test('stopProcess kills the process group on windows platforms', async () => {
    const pid = 456
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
    })

    const original = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32' })

    await service.stopProcess(pid)

    expect(killSpy).toHaveBeenCalledWith(-pid)
    killSpy.mockRestore()
    Object.defineProperty(process, 'platform', { value: original })
  })
})
