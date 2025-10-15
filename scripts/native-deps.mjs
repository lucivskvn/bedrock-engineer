#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SKIP_ENV_KEYS = [
  'BEDROCK_ENGINEER_SKIP_NATIVE_REBUILD',
  'SKIP_NATIVE_REBUILD'
];

const TRUE_LIKE_VALUES = new Set(['1', 'true', 'yes', 'on']);

function shouldSkipNativeRebuild() {
  for (const key of SKIP_ENV_KEYS) {
    const value = process.env[key];

    if (value && TRUE_LIKE_VALUES.has(value.toLowerCase())) {
      return true;
    }
  }

  return false;
}

function cleanAppBuilderArtifacts(nodeModulesDir) {
  if (!fs.existsSync(nodeModulesDir)) {
    return false;
  }

  const entries = fs.readdirSync(nodeModulesDir);
  let removed = false;

  for (const entry of entries) {
    if (entry.startsWith('.app-builder-bin')) {
      const targetPath = path.join(nodeModulesDir, entry);
      fs.rmSync(targetPath, { recursive: true, force: true });
      removed = true;
    }
  }

  return removed;
}

function resolveExecutable(candidate) {
  return fs.existsSync(candidate) ? candidate : null;
}

function runElectronBuilderInstall(rootDir) {
  const nodeModulesDir = path.join(rootDir, 'node_modules');
  const binDir = path.join(nodeModulesDir, '.bin');
  const binaryName = process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder';
  const binaryPath = resolveExecutable(path.join(binDir, binaryName));
  const args = ['install-app-deps'];

  if (binaryPath) {
    return spawnSync(binaryPath, args, { stdio: 'inherit' });
  }

  const npxBinary = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  return spawnSync(npxBinary, ['electron-builder', ...args], { stdio: 'inherit' });
}

export function cleanNativeRebuildArtifacts({ rootDir = process.cwd() } = {}) {
  const nodeModulesDir = path.join(rootDir, 'node_modules');
  return cleanAppBuilderArtifacts(nodeModulesDir);
}

export function runNativeRebuild({ allowFailure = false } = {}) {
  const rootDir = process.cwd();

  if (shouldSkipNativeRebuild()) {
    console.log('Skipping native dependency rebuild because skip flag is enabled.');
    return { skipped: true, success: true };
  }

  cleanNativeRebuildArtifacts({ rootDir });

  const result = runElectronBuilderInstall(rootDir);
  const status = typeof result.status === 'number' ? result.status : result.error ? 1 : 0;
  const errorInfo = {
    exitStatus: status,
    errorCode: result.error?.code ?? null
  };

  if (status !== 0) {
    if (allowFailure) {
      console.warn('Failed to rebuild native Electron dependencies automatically.', errorInfo);
      console.warn('Run `npm run rebuild:native` after installation completes to retry the rebuild.');
      return { skipped: false, success: false, code: status };
    }

    const error = new Error('Failed to rebuild native Electron dependencies automatically.');
    error.cause = errorInfo;
    throw error;
  }

  return { skipped: false, success: true, code: status };
}

function runFromCommandLine() {
  const [, , rawCommand] = process.argv;
  const command = rawCommand ?? 'rebuild';

  if (command === 'clean') {
    const removed = cleanNativeRebuildArtifacts();

    if (removed) {
      console.log('Removed cached electron-builder native artifacts from node_modules.');
    } else {
      console.log('No cached electron-builder native artifacts were found.');
    }

    return;
  }

  if (command === 'rebuild') {
    try {
      runNativeRebuild({ allowFailure: false });
      process.exit(0);
    } catch (error) {
      const metadata = {
        errorCode: error?.cause?.errorCode ?? error?.code ?? 'unknown_error',
        exitStatus: error?.cause?.exitStatus ?? null
      };

      console.error('Failed to rebuild native Electron dependencies automatically.', metadata);
      console.error('See the electron-builder output above for diagnostic details.');
      process.exit(1);
    }
  }

  console.error('Unknown native-deps command. Use either "rebuild" or "clean".');
  process.exit(1);
}

const scriptPath = fileURLToPath(import.meta.url);
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
const isDirectExecution = scriptPath === invokedPath;

if (isDirectExecution) {
  runFromCommandLine();
}
