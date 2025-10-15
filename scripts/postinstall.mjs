#!/usr/bin/env node
import { runNativeRebuild } from './native-deps.mjs';

const result = runNativeRebuild({ allowFailure: true });

if (result?.success === false) {
  process.exit(0);
}
