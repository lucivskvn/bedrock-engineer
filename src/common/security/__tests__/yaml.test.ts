import { parseYaml, stringifyYaml } from '../yaml'

describe('yaml security helpers', () => {
  it('parses simple YAML using the safe schema', () => {
    const result = parseYaml<{ name: string; count: number }>('name: test\ncount: 2')
    expect(result).toEqual({ name: 'test', count: 2 })
  })

  it('rejects dangerous YAML tags', () => {
    const maliciousYaml = 'exploit: !!js/function >\n  function () { return process.exit(); }'
    expect(() => parseYaml(maliciousYaml)).toThrow()
  })

  it('stringifies objects with the safe schema', () => {
    const output = stringifyYaml({ name: 'test', count: 2 })
    expect(output).toContain('name: test')
    expect(output).toContain('count: 2')
  })
})
