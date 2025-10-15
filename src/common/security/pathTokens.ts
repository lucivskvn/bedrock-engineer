import path from 'path'

export function toFileToken(filePath?: string | null): string {
  if (!filePath) {
    return '[unknown]'
  }

  const fileName = path.basename(filePath)
  if (!fileName) {
    return '[unknown]'
  }

  return `[${fileName}]`
}
