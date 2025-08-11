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
})
