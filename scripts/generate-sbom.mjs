import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'

const outputDir = resolve(process.cwd(), 'sbom')
mkdirSync(outputDir, { recursive: true })

const args = [
  '@cyclonedx/cyclonedx-npm',
  '--package-lock-only',
  '--ignore-npm-errors',
  '--output-format',
  'json',
  '--output-file',
  'sbom/bom.json'
]

const runner = spawn('npx', args, {
  stdio: 'inherit',
  shell: process.platform === 'win32'
})

runner.on('error', (error) => {
  console.error('Failed to launch CycloneDX generator', { error })
  process.exitCode = 1
})

runner.on('close', (code, signal) => {
  if (signal) {
    console.error('CycloneDX generator terminated unexpectedly', { signal })
    process.exitCode = 1
    return
  }

  if (code !== 0) {
    console.error('CycloneDX generator exited with a non-zero status', { exitCode: code })
    process.exitCode = code ?? 1
    return
  }

  console.info('CycloneDX SBOM written to sbom/bom.json')
})
