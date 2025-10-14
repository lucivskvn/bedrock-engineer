# Logging Hygiene and Redaction Policy

The logging stack is built on top of Winston 3.18 and is configured to produce value-stable entries that avoid leaking sensitive runtime information. Metadata is automatically sanitised before it reaches any transport (console or rotating log files).

## Message Guidelines

- **Keep log messages static.** Messages must read as human sentences without embedded runtime values such as years, IDs, or bucket names. Placeholders like `[USER_ID]` or `[REQUEST_ID]` may be used when a contextual hint is required.
- **Pass dynamic data through metadata.** Use structured objects or arrays when additional context is required. The sanitiser will redact raw values while preserving structural hints such as value length, array size, or error type.
- **Wrap standalone values in an object.** Passing `log.error('Failed', error)` works but the sanitiser will store the information under a generic key such as `meta_0`. Prefer `log.error('Failed', { error })` (or another descriptive property name) so operators can identify values quickly when scanning logs.
- **Prefer categories over bespoke prefixes.** When you need component-specific visibility use `createCategoryLogger('component-name')` instead of encoding the component name in the message string.
- **Treat MCP IPC handlers like any other logging surface.** The main-process MCP entrypoints now call `createCategoryLogger('mcp:ipc')` and emit static messages for initialisation, execution, and connection tests. When you add new handlers, keep the message string fixed and capture tool names, server counts, and raw errors inside the metadata payload.
- **Keep streaming instrumentation value-stable.** Real-time surfaces such as the Speak page audio worklet, Nova streaming clients, and renderer socket bridges must log connection IDs, tool types, durations, and payload previews through metadata only. Leave the primary message as a constant string so repeated audio updates or WebSocket events do not spam dynamic content into production logs.

## Cross-Process Logging APIs

- **Preload modules** must log through the exported `preloadLogger` (or a `createPreloadCategoryLogger` instance). These helpers forward payloads to the main process via IPC and ensure metadata is sanitised before it touches Winston.
- **Renderer modules** must import `rendererLogger` or use the `window.logger` bridge that the preload script exposes. Do not call `console.error` / `console.warn` directly from React components or hooks—browser consoles bypass the sanitiser and reintroduce dynamic values into message strings.
- **Shared utilities** that run in both environments should accept a logger instance (defaulting to `window.logger.log` in the renderer) rather than importing `console` so callers can supply the appropriate bridge.

## Metadata Sanitisation

The helper `prepareLogMetadata` automatically replaces runtime data with structural summaries:

| Input Value                          | Sanitised Output Example                               |
| ------------------------------------ | ------------------------------------------------------ |
| `'secret-value'`                     | `'[string length=12]'`                                 |
| `42`                                 | `'[number]'`                                           |
| `['a', 'b', 'c', 'd']`               | `{ type: 'array', length: 4, preview: [...], truncated: 1 }` |
| `new Error('network failed')`        | `{ type: 'Error', name: 'Error', message: '[string length=14]', stack: '[stack length=… lines=…]' }` |
| `{ category: 'proxy', status: 500 }` | `{ category: 'proxy', status: '[number]' }`            |

The sanitiser keeps reserved keys like `category` and `process` untouched so that log routing continues to work, while all other primitive values are summarised.

## Structured Validation Errors

Validation utilities now emit structured exceptions created via `createStructuredError`. Helpers such as
`ensureValidStorageKey` and `coerceAwsCredentials` throw static-message errors with a `code` identifier and a
`metadata` object that describes the failure (for example `{ label: 'AWS access key ID', receivedType: 'number' }`).
When handling these failures, inspect the structured fields instead of parsing message strings:

```ts
try {
  coerceAwsCredentials({ accessKeyId: 123 });
} catch (error) {
  if (error && typeof error === 'object' && 'code' in error) {
    logger.warn('AWS credential rejected', {
      reason: (error as { code: string }).code,
      metadata: (error as { metadata?: unknown }).metadata
    });
  }
}
```

This keeps primary log messages static while still surfacing enough context for operators and telemetry dashboards.

Configuration-store sanitisation follows the same pattern. Helpers such as
`sanitizeProjectPathValue`, `sanitizeProxyConfiguration`, and the `store`
getter/setter methods emit `StoreValidationError` (for input issues like
`project_path_empty` or `proxy_missing_required_fields`) or
`StoreStateError` (for availability problems like `store_uninitialized`).
Downstream callers should branch on the `error.code` value and consult the
`metadata` payload for remediation details instead of comparing message
strings.

### Structured Tool Errors

Tool execution utilities apply the same discipline. The preload error
wrappers (`wrapError`, `ToolNotFoundError`, `RateLimitError`, etc.) always
emit static message strings (`'Tool execution failed.'`, `'Tool not found.'`,
`'Tool rate limit exceeded.'`). Runtime context—tool names, underlying service
messages, and throttling hints—lives exclusively inside the `metadata`
payload (`causeName`, `causeMessage`, `detailMessage`, `resultDetails`, and so
on). When you surface these errors in UI components or logs, read the
structured fields instead of interpolating the metadata back into the primary
message.

Filesystem automation follows the same rule through `createFileExecutionError`
and `summarizeError`. File tools (`writeToFile`, `copyFile`, `moveFile`,
`createFolder`, `applyDiffEdit`, and the various `readFiles`/`listFiles`
subroutines) emit the fixed message `'Tool execution failed.'` alongside reason
codes such as `WRITE_FILE_FAILED`, `FILE_TOO_LARGE`, `READ_DOCX_FAILED`, and
`LIST_FILES_FAILED`. The associated metadata carries hashed filesystem paths,
content-length hints, byte thresholds, and a redacted `detailMessage`. When you
handle these failures, branch on the reason code and consult the metadata object
instead of comparing message text or attempting to rehydrate the original
exception.

The Code Interpreter task manager applies the same policy. Task snapshots and
list results now expose a structured `errorInfo` object alongside the legacy
`error` string. The `message` field stays static (`'Task execution failed.'`,
`'Task not found.'`, `'Task list retrieved.'`, etc.) while the `code` and
`metadata` fields carry task IDs, validation errors, or workspace details. Use
those structured fields when presenting diagnostics in the renderer or when
emitting follow-up logs so task identifiers and filesystem paths remain outside
the primary message text.

### Command Service Structured Errors

The desktop command runner (`CommandService`) now emits `CommandServiceError`
instances created through `createCommandError`. Every rejection carries a
stable `message` string (for example `'Command execution failed.'`,
`'Command execution timed out.'`, or `'Command execution rejected by
allowlist.'`) alongside a `code` identifier such as
`COMMAND_RUNTIME_FAILURE`, `COMMAND_TIMEOUT`, or `COMMAND_NOT_ALLOWED`.

Dynamic details—command text, working directories, stdout/stderr payloads, and
process identifiers—are stored in the `metadata` object as hashed structural
summaries (length, SHA-256 digest, exit codes, hint flags, etc.). When handling
these failures, branch on `error.code` and consume the metadata instead of
displaying or logging raw shell commands.

Invalid working directories rejected with `COMMAND_WORKDIR_RESOLUTION_FAILED`
now hash the user-provided path before attaching it to `error.metadata`. The
`stopProcess` helper also falls back to killing the specific child on Windows
and treats missing processes (`ESRCH`) as a successful no-op, so consumers
should not rely on negative PIDs being available across platforms.

```ts
try {
  await commandService.executeCommand({ command: 'ls -la', cwd: projectPath })
} catch (error) {
  if (error && typeof error === 'object' && 'code' in error) {
    log.warn('Command execution rejected', {
      code: (error as { code: string }).code,
      metadata: (error as { metadata?: unknown }).metadata
    })
  }
}
```

### Background Agent Structured Errors

Background session persistence and scheduling follow the same policy. The
session manager, chat service, and scheduler raise `BackgroundAgentError`
instances with fixed messages—`'Failed to write background session file.'`,
`'Invalid cron expression for background task.'`, `'Background agent not
found.'`, etc.—while attaching hashed context to `error.metadata`. Expect codes
such as `background_session_write_failed`,
`background_cron_expression_invalid`, `background_agent_not_found`, and
`background_execution_result_missing` when persisting chat transcripts,
validating cron expressions, or locating scheduled tasks.

When handling these failures, branch on `error.code` and prefer the structured
metadata (`sessionId`, `taskId`, hashed project paths, remediation hints)
instead of stitching together message text. This keeps agent IDs, cron
expressions, and filesystem roots out of the primary log string while still
surfacing actionable diagnostics to operators and renderer clients.

### API Error Responses

Main-process HTTP routes and the Socket.IO bridge now emit structured payloads
via `createApiError` and `sendApiErrorResponse`. Each failure returns a stable
`message`, a machine-readable `code`, optional `metadata`, and a `referenceId`
that is mirrored in the backend logs. Client code should branch on the `code`
value and inspect `metadata` instead of parsing `message` text. The
`referenceId` can be echoed to users or telemetry to correlate frontend issues
with server-side logs without exposing raw error strings. `sendApiErrorResponse`
also ensures that every HTTP failure includes an `X-Request-Id` header that
matches the payload `referenceId`, plus `Cache-Control`/`Pragma`/`Expires`
directives and an explicit JSON content type so intermediaries cannot cache or
reinterpret sensitive responses.

### PDF Processing Structured Errors

Main-process PDF IPC handlers (`pdf-extract-text`, `pdf-extract-metadata`, and
`pdf-get-info`) emit `PdfProcessingError` instances that keep top-level
messages static (`'PDF text extraction failed.'`, `'PDF file could not be
parsed.'`, `'PDF info retrieval failed.'`, etc.). Runtime context—requested and
resolved paths, allowed directory allowlists, project/user data configuration,
line-range validation results, parse failures, and byte-size limits—lives in
`error.metadata` as placeholder strings (for example `[hash value=…]`, `[bytes
value=…]`, `[line value=…]`).

If the bundled `pdf-parse` dependency is missing its `PDFParse` class export
(which happens when a stale 1.x release is still installed), the handlers raise
`PDF_PARSE_FAILED` with `metadata.reason === 'parser_initialization_failed'` and
`metadata.remediation === 'Reinstall dependencies with npm ci to refresh pdf-parse >=2.2.16.'`.
Surface the remediation hint as-is and avoid logging raw error messages—the
structured metadata already captures `parserExportType` so you can confirm
whether the module export resolved to `undefined`, `function`, or another
unexpected type without leaking implementation details.

When you surface these failures (in renderer bridges or follow-up logs), branch
on `error.code` values such as `PDF_FILE_TOO_LARGE`, `PDF_PARSE_FAILED`, or
`PDF_TEXT_EXTRACTION_FAILED` and display the structured metadata. Do not
concatenate file paths or line numbers into the primary message string; the
metadata already exposes hashed path summaries, boolean flags indicating which
configuration fields were present, and the validated `from`/`to` line bounds for
redacted line-range requests.

## Testing Changes

Run the targeted unit tests when touching the logging utilities:

```bash
npm test -- src/common/logger/__tests__/utils.test.ts
```

The suite verifies that sanitisation is lossless for structure, resists circular references, and emits predictable console payloads.

### Capturing Logs in Tests

Jest installs a buffered console writer automatically (see `src/test/setup/logging.ts`).
This keeps the test output free from `[WARN]`/`[ERROR]` noise while still letting
specs assert against the sanitised payloads.

```ts
import { getLoggerBuffer } from '../test/setup/logging'

it('logs a validation failure with redacted metadata', () => {
  const buffer = getLoggerBuffer()

  log.error('Configuration rejected', { reason: 'invalid-project-path' })

  expect(buffer.snapshot()).toContainEqual(
    expect.objectContaining({
      level: 'error',
      formatted: expect.stringContaining('[ERROR] Configuration rejected')
    })
  )
})
```

If you need bespoke assertions, call `setConsoleWriter()` with a test-specific
handler (for example, `setConsoleWriter(createBufferedConsoleWriter().write)`) and
reset it afterwards to avoid leaking state between suites.

## Automated Enforcement

In addition to the unit tests, `npm run lint:logs` statically analyses every TypeScript **and** JavaScript source beneath
`src/` and `scripts/`. The task fails if any `logger.warn(...)`, `logger.error(...)`, shared `log.warn(...)`/`log.error(...)`, or
even `console.warn(...)`/`console.error(...)` call uses a template literal or variable as the primary message. The command runs
automatically as part of `npm run lint`, so fix any reported violations by moving dynamic data into the metadata object before
committing your changes—even for CLI utilities and build scripts.

## Cleaning Developer Artefacts

The repository ignores transient log files by default (`*.log*` and `out/logs`). If you accidentally generated additional artefacts while debugging, please remove them before committing.

## Logging from Python-Based Agents

The sample Bedrock directory agent located at
`src/renderer/src/assets/directory-agents/amazon-bedrock-agents-builder.yaml`
exposes helper functions such as `_format_log_summary` and
`_summarize_exception` to keep CloudWatch payloads stable. When you extend the
Python samples—or contribute agents in another runtime—mirror this approach:

- keep the primary `logger.info`/`logger.error` message static;
- summarise dictionaries and exceptions before serialising them to strings;
- avoid embedding request payloads or customer data in formatted strings.

These helpers produce JSON snippets that describe key counts, nested value
presence, and exception metadata (type name, message length, etc.) so that
operational dashboards remain informative without exposing sensitive content.
