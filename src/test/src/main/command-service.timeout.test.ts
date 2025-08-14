import { CommandService } from '../../../main/api/command/commandService'

describe('CommandService timeout handling', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  test('kills long running process when timeout elapses', async () => {
    const service = new CommandService({
      allowedCommands: [{ pattern: 'sleep 1000', description: 'test' }],
      shell: '/bin/bash'
    })

    const promise = service.executeCommand({
      command: 'sleep 1000',
      cwd: process.cwd()
    })

    const running = service.getRunningProcesses()
    expect(running.length).toBe(1)
    const pid = running[0].pid

    // process should exist
    expect(() => process.kill(pid, 0)).not.toThrow()

    // Fast-forward to trigger the timeout
    jest.advanceTimersByTime(5 * 60 * 1000)

    await expect(promise).rejects.toThrow('Command timed out')

    // allow event loop to process kill
    await Promise.resolve()

    // process should be terminated and removed
    expect(() => process.kill(pid, 0)).toThrow()
    expect(service.getRunningProcesses().length).toBe(0)
  })
})

