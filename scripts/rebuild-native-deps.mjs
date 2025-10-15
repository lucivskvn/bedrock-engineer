#!/usr/bin/env node
import { runNativeRebuild } from './native-deps.mjs';

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
