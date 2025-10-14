import { readdir, readFile } from 'fs/promises'
import path from 'path'
import ts from 'typescript'

const ROOTS = ['src', 'scripts']
const IGNORED_DIRECTORIES = new Set(['node_modules', 'dist', 'out', '.git', 'coverage'])
const ELIGIBLE_EXTENSIONS = new Set(['.ts', '.tsx', '.cts', '.mts', '.js', '.jsx', '.cjs', '.mjs'])
const SCRIPT_KIND_BY_EXTENSION = new Map([
  ['.ts', ts.ScriptKind.TS],
  ['.tsx', ts.ScriptKind.TSX],
  ['.cts', ts.ScriptKind.TS],
  ['.mts', ts.ScriptKind.TS],
  ['.js', ts.ScriptKind.JS],
  ['.jsx', ts.ScriptKind.JSX],
  ['.cjs', ts.ScriptKind.JS],
  ['.mjs', ts.ScriptKind.JS]
])
const ALLOWED_FILES = new Set([
  path.join('src', 'preload', 'tools', 'common', 'Logger.ts'),
  path.join('src', 'preload', 'logger.ts'),
  path.join('src', 'common', 'logger', 'utils.ts')
])

function shouldInspect(filePath) {
  const ext = path.extname(filePath)
  return ELIGIBLE_EXTENSIONS.has(ext) && !ALLOWED_FILES.has(filePath)
}

async function collectFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (IGNORED_DIRECTORIES.has(entry.name)) {
      continue
    }
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)))
    } else if (entry.isFile()) {
      const relative = path.relative(process.cwd(), fullPath)
      if (shouldInspect(relative)) {
        files.push({ fullPath, relative })
      }
    }
  }
  return files
}

function isPropertyAccess(node) {
  return ts.isPropertyAccessExpression(node) || ts.isPropertyAccessChain?.(node)
}

function getPropertyName(node) {
  return node.name?.text ?? undefined
}

function expressionContainsLogger(node) {
  if (!node) {
    return false
  }

  if (ts.isIdentifier(node)) {
    const text = node.text.toLowerCase()
    if (text === 'log' || text.includes('logger')) {
      return true
    }

    if (text === 'console') {
      return true
    }

    return false
  }

  if (isPropertyAccess(node)) {
    const propertyName = getPropertyName(node)
    if (propertyName) {
      const lowered = propertyName.toLowerCase()
      if (lowered === 'log' || lowered.includes('logger')) {
        return true
      }
    }
    return expressionContainsLogger(node.expression)
  }

  if (ts.isElementAccessExpression(node)) {
    return expressionContainsLogger(node.expression)
  }

  return false
}

function isStaticLogMessage(argument) {
  if (!argument) {
    return true
  }

  if (ts.isStringLiteral(argument)) {
    return true
  }

  if (ts.isNoSubstitutionTemplateLiteral(argument)) {
    return true
  }

  return false
}

const summarizeString = (value) => `[string length=${value.length}]`

const summarizeStack = (value) => {
  const lines = value.split(/\r?\n/).length
  return `[stack lines=${lines}]`
}

function summarizeUnknown(value) {
  if (value === null) {
    return '[null]'
  }

  if (value === undefined) {
    return '[undefined]'
  }

  if (typeof value === 'string') {
    return summarizeString(value)
  }

  if (typeof value === 'number') {
    return '[number]'
  }

  if (typeof value === 'boolean') {
    return '[boolean]'
  }

  if (typeof value === 'bigint') {
    return '[bigint]'
  }

  if (typeof value === 'symbol') {
    return '[symbol]'
  }

  if (value instanceof Error) {
    const payload = {
      type: value.name || 'Error'
    }

    if (typeof value.message === 'string' && value.message.length > 0) {
      payload.message = summarizeString(value.message)
    }

    if (typeof value.stack === 'string' && value.stack.length > 0) {
      payload.stack = summarizeStack(value.stack)
    }

    if (typeof value.code === 'string' && value.code.length > 0) {
      payload.code = summarizeString(value.code)
    }

    return payload
  }

  if (Array.isArray(value)) {
    return {
      type: 'Array',
      length: value.length
    }
  }

  if (typeof value === 'object') {
    const prototypeName = value?.constructor?.name
    const keyCount = Object.keys(value ?? {}).length
    return {
      type: prototypeName && prototypeName !== 'Object' ? prototypeName : 'Object',
      keys: keyCount
    }
  }

  return '[unknown]'
}

function visit(node, sourceFile, filePath, violations) {
  if (ts.isCallExpression(node)) {
    const expression = node.expression
    if (isPropertyAccess(expression)) {
      const methodName = getPropertyName(expression)
      if (methodName && (methodName === 'warn' || methodName === 'error')) {
        if (expressionContainsLogger(expression.expression)) {
          const [firstArg] = node.arguments
          if (!isStaticLogMessage(firstArg)) {
            const { line, character } = sourceFile.getLineAndCharacterOfPosition(
              node.getStart()
            )
            violations.push({
              filePath,
              line: line + 1,
              column: character + 1,
              text: sourceFile.text
                .slice(firstArg.getStart(), firstArg.getEnd())
                .slice(0, 80)
            })
          }
        }
      }
    }
  }

  ts.forEachChild(node, (child) => visit(child, sourceFile, filePath, violations))
}

async function main() {
  const violations = []
  for (const root of ROOTS) {
    const fullRoot = path.join(process.cwd(), root)
    const files = await collectFiles(fullRoot)
    for (const { fullPath, relative } of files) {
      const content = await readFile(fullPath, 'utf8')
      const ext = path.extname(relative)
      const scriptKind = SCRIPT_KIND_BY_EXTENSION.get(ext) ?? ts.ScriptKind.TSX
      const sourceFile = ts.createSourceFile(
        relative,
        content,
        ts.ScriptTarget.ESNext,
        true,
        scriptKind
      )
      visit(sourceFile, sourceFile, relative, violations)
    }
  }

  if (violations.length > 0) {
    console.error('Detected non-static warn/error logger messages.', {
      violationCount: violations.length
    })
    for (const violation of violations) {
      console.error('Non-static warn/error logger message detected.', {
        filePath: violation.filePath,
        line: violation.line,
        column: violation.column,
        preview: violation.text
      })
    }
    process.exitCode = 1
    return
  }
}

main().catch((error) => {
  console.error('Failed to validate logger messages.', {
    error: summarizeUnknown(error)
  })
  process.exitCode = 1
})
