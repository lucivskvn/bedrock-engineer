import yaml from 'js-yaml'

const SAFE_YAML_SCHEMA = yaml.JSON_SCHEMA

export function parseYaml<T = unknown>(input: string): T {
  const parsed = yaml.load(input, {
    schema: SAFE_YAML_SCHEMA,
    json: true
  })

  if (parsed === undefined || parsed === null) {
    throw new Error('YAML content is empty')
  }

  return parsed as T
}

export function stringifyYaml(input: unknown): string {
  return yaml.dump(input, {
    schema: SAFE_YAML_SCHEMA,
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    sortKeys: false
  })
}
