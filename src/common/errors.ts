export type StructuredError<Code extends string = string> = Error & {
  code: Code
  metadata?: Record<string, unknown>
}

export function createStructuredError<Code extends string>(
  {
    name,
    message,
    code,
    metadata
  }: {
    name: string
    message: string
    code: Code
    metadata?: Record<string, unknown>
  }
): StructuredError<Code> {
  const error = new Error(message) as StructuredError<Code>
  error.name = name
  error.code = code

  if (metadata && Object.keys(metadata).length > 0) {
    error.metadata = metadata
  }

  return error
}
