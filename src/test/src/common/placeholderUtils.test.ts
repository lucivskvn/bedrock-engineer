import { replacePlaceholders } from '../../../common/utils/placeholderUtils'
import { CommandConfig } from '../../../types/agent-chat'

describe('replacePlaceholders', () => {
  test('replaces projectPath values containing $', () => {
    const text = 'Path: {{projectPath}}'
    const result = replacePlaceholders(text, { projectPath: '/tmp/$HOME' })
    expect(result).toBe('Path: /tmp/$HOME')
  })

  test('replaces allowedCommands values containing $', () => {
    const commands: CommandConfig[] = [
      { pattern: 'echo $PATH', description: 'show path' }
    ]
    const text = 'Commands: {{allowedCommands}}'
    const result = replacePlaceholders(text, {
      projectPath: '',
      allowedCommands: commands
    })
    expect(result).toBe(`Commands: ${JSON.stringify(commands)}`)
  })
})
