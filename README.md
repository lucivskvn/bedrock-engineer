[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/aws-samples/bedrock-engineer) [![Workshop Studio](https://img.shields.io/badge/Workshop_Studio-8A2BE2)](https://catalog.us-east-1.prod.workshops.aws/workshops/57e0af6e-41a5-42cc-98e0-1f1a3fd0c6c4/ja-JP)

Language: [English](./README.md) / [Japanese](./README-ja.md)

> **Documentation language policy** — English is the source of truth for maintenance notes and contributor guidance. Provide translations only when the entire document is localised (for example, [README-ja.md](./README-ja.md)).

# 🧙 Bedrock Engineer

Bedrock Engineer is Autonomous software development agent apps using [Amazon Bedrock](https://aws.amazon.com/bedrock/), capable of customize to create/edit files, execute commands, search the web, use knowledge base, use multi-agents, generative images and more.

## 💻 Demo

https://github.com/user-attachments/assets/f6ed028d-f3c3-4e2c-afff-de2dd9444759

## Deck

- [English](https://speakerdeck.com/gawa/introducing-bedrock-engineer-en)
- [Japanese](https://speakerdeck.com/gawa/introducing-bedrock-engineer)

## 🍎 Getting Started

Bedrock Engineer is a native app, you can download the app or build the source code to use it.

### Download

MacOS:

[<img src="https://img.shields.io/badge/Download_FOR_MAC-Latest%20Release-blue?style=for-the-badge&logo=apple" alt="Download Latest Release" height="40">](https://github.com/aws-samples/bedrock-engineer/releases/latest/download/bedrock-engineer-1.19.1.pkg)

Windows:

[<img src="https://img.shields.io/badge/Download_FOR_WINDOWS-Latest%20Release-blue?style=for-the-badge" alt="Download Latest Release" height="40">](https://github.com/aws-samples/bedrock-engineer/releases/latest/download/bedrock-engineer-1.19.1-setup.exe)

It is optimized for MacOS, but can also be built and used on Windows and Linux OS. If you have any problems, please report an issue.

> **October 2025 security update** — Command execution now ships with hardened defaults:
>
> - `maxConcurrentProcesses` limits simultaneous command launches (default `2`; set `0` to disable the cap).
> - `maxStdinBytes` blocks oversized standard-input payloads (default `65536` bytes, capped at `262144`).
> - `passthroughEnvKeys` is an explicit allow-list for environment variables that may reach spawned processes (uppercase `[A-Z0-9_]` only).
> - `additionalPathEntries` extends the sanitised `PATH` via the `commandSearchPaths` preference without leaking host secrets.
>
> Configure these values from **Settings → Advanced → Command execution** or by editing the encrypted store keys `commandMaxConcurrentProcesses`, `commandMaxStdinBytes`, `commandPassthroughEnvKeys`, and `commandSearchPaths`.

> **October 2025 logging update** — Runtime values are now redacted from warning/error metadata. Keep message strings static and move dynamic details into metadata (placeholders like `[USER_ID]` are safe). See [Logging Hygiene and Redaction Policy](./docs/logging.md) for examples and testing guidance.
> - Tool handlers should throw `ExecutionError` (or filesystem helpers) so that the emitted message stays static while request-specific fields live in the `cause`/metadata payload.
> - Main-process file helpers should convert user paths with `toFileToken(path)` before logging or throwing so filenames stay redacted across logs and error payloads.
> - Media generation tools (GenerateImage/GenerateVideo) now tokenise `outputPath` metadata before logging or surfacing errors. When extending these flows—including DownloadVideo—reuse `toFileToken` so renderer diagnostics never expose raw directories.
> - FetchWebsite saves should tokenise any persisted file paths with `toFileToken`, keep user-facing status strings static, and record granular diagnostics (error names, truncated messages, directory tokens) in metadata rather than the message text.
> - Renderer toast notifications must keep `toast.success` / `toast.error` copy static. Log sanitised metadata for server names, durations, and failure reasons instead of interpolating them back into the toast text.
> - Tavily web searches must keep log and response messages static. Record only truncated (≤100 character) query previews inside metadata, avoid dumping the full Tavily configuration object into logs, and return the fixed `'Tavily search completed.'` success string so sensitive queries stay out of persisted message text.
> - Command execution tooling must keep error strings static (`'Failed to resolve working directory.'`, `'Command execution failed.'`) while logging sanitised metadata from the helper introduced in `ExecuteCommandTool`. Always tokenise working directories before logging or surfacing errors.
> - Vision recognition flows (RecognizeImage, ScreenCapture, CameraCapture) use `DEFAULT_RECOGNIZE_IMAGE_MODEL_ID` for fallback inference and must surface failures as `'Failed to analyze this image.'` with diagnostics provided through metadata fields such as `errorName`, `errorCode`, and tokenised paths.

<details>
<summary>Tips for Installation</summary>

### Installation

1. Download the latest release (PKG file)
2. Double-click the PKG file to start installation
3. If you see a security warning, follow the steps below
4. Launch the app and configure your AWS credentials

### macOS Security Warning

When opening the PKG file, you may see this security warning:

![PKG Security Warning](./assets/macos-security-warning-pkg.png)

**To resolve this:**

1. Click "Done" to dismiss the warning dialog
2. Open System Preferences → Privacy & Security
3. Scroll down to the Security section
4. Find "bedrock-engineer-1.19.1.pkg was blocked to protect your Mac"
5. Click "Open Anyway" button

This security warning appears because the application is not distributed through the Mac App Store.

![PKG Security Warning Privacy Setting](./assets/macos-security-warning-pkg-privacy-setting.png)

### Configuration Issues

If a configuration file error occurs when starting the application, please check the following configuration files. If you cannot start the application even after deleting the configuration files and restarting it, please file an issue.

`/Users/{{username}}/Library/Application Support/bedrock-engineer/config.json`

</details>

### Build

First, install the npm modules.

Make sure Node.js 20 is active by running `nvm use`:

```bash
nvm use
npm ci
```

> [!NOTE]
> The install step now runs a guarded native rebuild. If you skip lifecycle scripts or the rebuild reports a failure, rerun it manually with `npm run rebuild:native` after dependencies finish installing. The helper clears lingering `.app-builder-bin-*` caches before invoking `electron-builder`, so stale binaries stop causing `ENOTEMPTY` rename errors. If the installer still reports an `app-builder-bin` cache issue, run `npm run clean:native` and retry.

Then, build application package

```bash
npm run build:mac
```

or

```bash
npm run build:win
```

or

```bash
npm run build:linux
```

Use the application stored in the `dist` directory.
### Lint, Typecheck, and Test

Install dependencies and run code checks:

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run test:integration
```

To run the full verification suite (lint, type checks, and unit tests with coverage) in one step, use the aggregate script:

```bash
npm run ci:verify
```

> [!TIP]
> A containerised workflow is available for reproducible local checks. Build the image and execute the same verification script with Docker:
>
> ```bash
> docker compose build verify
> docker compose run --rm verify
> ```
>
> Rebuild the image whenever you update dependencies so the container picks up the latest lockfile.

#### Generate a CycloneDX SBOM

Create a CycloneDX JSON software bill of materials for dependency auditing with:

```bash
npm run sbom:generate
```

The generated document is written to `sbom/bom.json` (ignored by Git on purpose). The helper now surfaces non-zero exit codes from `@cyclonedx/cyclonedx-npm`, so inspect the preceding logs if the command halts after upstream `npm ls` warnings.

> The Jest wrapper verifies that `jest` and `jest-environment-jsdom` are installed before execution; if it reports missing dependencies, rerun `npm ci` (or `npm install`) to restore the pinned toolchain before retrying the test or lint commands.
> The TypeScript wrapper now confirms that `typescript` is installed, then resolves every `extends` config and `references.path` entry declared in the requested tsconfig files before running `npm run typecheck:*`; rerun `npm ci` (or restore the missing config files) if it exits with a missing dependency warning.


##### Coverage expectations

Unit tests must maintain **≥95%** statements, branches, functions, and lines
across the authentication and health surfaces under `src/main/api` (specifically
`auth/token-utils.ts`, `config/runtime-config.ts`, and the files within
`health/`). These modules gate startup security checks and the `/healthz`
endpoint, so we require deterministic coverage before merging changes. Run
`npm run ci:verify` or `npm test -- --coverage` before sending changes to ensure
the threshold passes and to catch regressions early.

#### Security and compliance automation

Run the following commands locally before opening a pull request to mirror the
automated compliance gates:

- `npm run security:audit` — fails on any high/critical dependency vulnerability reported by `npm audit`.
- `npm run license:check` — validates that the production dependency tree exposes only MIT, MIT-0, Apache-2.0, BSD, or ISC
  licensed packages.
- `npm run dast` — executes the integration smoke suite against the hardened API surface to mimic the CI dynamic scan.


#### GitHub Actions workflow

The Bitbucket pipeline has been superseded by `.github/workflows/build.yml`. The
workflow mirrors the local verification commands (`npm run ci:verify`,
`npm run security:audit`, `npm run license:check`, `npm run dast`) and adds
container image scanning via Trivy. The `verify` and `dast` jobs assume an IAM
role through GitHub’s OpenID Connect integration using the repository secrets
`AWS_ROLE_TO_ASSUME` and `AWS_REGION`. Provide the appropriate `SECRETS_DRIVER`
value for each environment via encrypted secrets or environment configuration.
When the variable is omitted the runtime inspects the environment and logs a
warning before defaulting to AWS Secrets Manager (or Vault when Vault settings
are detected). Set the value explicitly to silence the warning and guarantee
the intended provider. The workflow sets `SECRETS_DRIVER=aws-secrets-manager`
by default; adjust the value for Vault-backed staging or production projects.
Electron build artefacts are cached with `actions/cache@v4` to keep rebuild
times predictable across runs.

To complete the migration, mark the old Bitbucket pipelines as read-only once
the GitHub Actions workflow is green in your environment. Branch protection
rules should require the `verify`, `sast`, `dast`, and `container-scan` jobs so
that future pull requests cannot bypass the strengthened gates.


### Authentication and authorisation

The embedded API now enforces role-based access control. Every request must supply an API token either through the `X-API-Key`
header or a Bearer token. Tokens can be defined through:

* `API_AUTH_TOKEN` – primary environment token (defaults to the admin role).
* `API_AUTH_TOKEN_SHA256` – optional hex-encoded SHA-256 digest for the environment token. When present it overrides
  `API_AUTH_TOKEN`, keeping the plaintext secret out of process environments. The runtime clears the
  `API_AUTH_TOKEN` variable and removes any stored plaintext token once the digest is detected so child processes cannot
  observe the secret or persist it on disk.
* `API_AUTH_TOKEN_ROLE` / `API_AUTH_TOKEN_PERMISSIONS` – optional overrides for the environment token (comma-separated
  permission names such as `monitoring:read`).
* `API_AUTH_STORE_ROLE` / `API_AUTH_STORE_PERMISSIONS` – overrides for the token persisted in the encrypted Electron store.
* `API_AUTH_SECRET_ID` – when set, the server loads tokens from the configured secret
  manager. Pair it with `SECRETS_DRIVER` to select the backend and optional
  companions like `API_AUTH_SECRET_REGION` (AWS) or `API_AUTH_SECRET_FIELD`
  (Vault KV field name). `API_AUTH_SECRET_CACHE_SECONDS` limits how long secret
  payloads remain cached in-process (default 60 seconds, max 3600).
* `SECRETS_DRIVER` – selects the external secret manager implementation. Supported
  values are `aws-secrets-manager` (or `aws`) and `hashicorp-vault` (or `vault`).
  The runtime refuses to contact any secret manager when this variable is
  missing; it emits an error and, if possible, suggests the most likely provider
  inferred from the environment (Vault signals take priority over AWS). Always
  set the variable explicitly in production environments to keep Zero-Trust
  guarantees intact and document the intended backend.
  * AWS Secrets Manager: optionally supply `API_AUTH_SECRET_REGION` and
    `API_AUTH_SECRET_ENDPOINT` if you use a regional or VPC endpoint.
  * HashiCorp Vault: configure `SECRETS_VAULT_ADDR`, `SECRETS_VAULT_NAMESPACE`
    (if multi-tenant), and either AppRole credentials (`SECRETS_VAULT_APPROLE_ROLE_ID`
    / `SECRETS_VAULT_APPROLE_SECRET_ID`) or JWT auth (`SECRETS_VAULT_JWT_ROLE` plus
    `SECRETS_VAULT_JWT` or `SECRETS_VAULT_JWT_FILE`). Use
    `SECRETS_VAULT_AUTH_MOUNT` when your auth method lives under a custom path and
    `SECRETS_VAULT_TOKEN_RENEW_WINDOW_SECONDS` to control token refresh margins.
    Set `API_AUTH_SECRET_FIELD` to the KV data field that contains the JSON payload
    (defaults to serialising the entire `data` object when omitted).

Secret payloads must contain JSON in the following structure (identical for AWS
and Vault-based stores):

```json
{
  "tokens": [
    { "sha256": "<hex-encoded SHA-256 digest>", "role": "operator" },
    { "token": "<plain-text token>", "role": "observer", "permissions": ["monitoring:read"] }
  ],
  "roles": {
    "observer": ["monitoring:read"],
    "operator": ["monitoring:read", "bedrock:converse-stream", "bedrock:list-models", "bedrock:diagnostics", "sonic:stream-session"]
  }
}
```

Omit the `token` field when storing only hashed secrets. Valid permission names are:

* `monitoring:read` – access to `/metrics`.
* `bedrock:converse-stream` – POST `/converse/stream` and socket streaming.
* `bedrock:list-models` – GET `/listModels`.
* `bedrock:diagnostics` – GET `/nova-sonic/region-check` and `/bedrock/connectivity-test`.
* `sonic:stream-session` – Nova Sonic socket life-cycle events.

The default roles are:

* `admin` – all permissions.
* `operator` – all Bedrock and metrics permissions.
* `observer` – metrics only.

Custom roles can be declared inside the secret `roles` map. Invalid role names or permission strings are surfaced through the
`/healthz` report to simplify operational diagnostics.

### Disaster recovery

* **Configuration backups** – the Electron configuration store (`config.json` under the user data directory) should be backed
  up with standard workstation profile backups. The store contains generated API tokens and AWS profile preferences.
* **SBOM snapshots** – run `npm run sbom:generate` during release preparation and retain the resulting `sbom/bom.json` for
  compliance audits.
* **Rehydrating secrets** – when using AWS Secrets Manager, document the secret ARN alongside the infrastructure-as-code
  templates so that a compromised deployment can rotate tokens and reapply role policies quickly.
* **Operational restoration** – after redeploying the desktop application, re-run the readiness checks (`/readyz` and
  `/metrics`) to confirm Bedrock connectivity before directing traffic back to the node.

#### October 2025 maintenance notes

- ESLint now consumes the flat-config-powered `typescript-eslint` bundle. The meta package, parser, and plugin are pinned as direct dev dependencies so `npm ci`/`npm install` refreshes the full stack before invoking `npm run lint`; the lint wrapper resolves the trio from the workspace root as well as nested `node_modules` directories and exits with a remediation hint if any of them are missing.
- Renderer bundles now target **React 19.x** and **React DOM 19.x**. Import `type { ReactElement }` (or use `React.ReactElement`) when annotating component return types—the ambient `JSX` namespace is no longer exposed globally by the `@types/react` package.
- The TypeScript toolchain now targets TypeScript 5.9.x together with `@types/node@22.18.x`. Remove stale `node_modules` directories and rerun `npm ci` if you encounter compiler errors that reference missing 5.9 features or Node 22 ambient types.
- Type checking commands now execute through `scripts/run-tsc.mjs`, which resolves `typescript`, walks every `extends` entry, and verifies each project reference path declared in the requested tsconfig files (including hoisted installs) before spawning `tsc`. Refresh your dependencies with `npm ci` or restore the missing config package if the wrapper reports unresolved extends or references.
- Shared tsconfig presets have been bumped to `@electron-toolkit/tsconfig@2.0.0`, which enables bundler-style module resolution for renderer code and opts Node-facing projects into `moduleResolution: nodenext`. If you maintain custom `tsconfig.*` variants, mirror the new `moduleDetection: "force"` / module resolution settings so imports of packages that expose only ESM exports continue to resolve under TypeScript 5.9.
- Main-process helpers that depend on ESM-only packages (for example `fix-path`, `get-port`, or `node-fetch`) now resolve them lazily with `await import(...)`. When introducing new runtime dependencies under `src/main` or `src/preload`, prefer the same async wrapper pattern instead of static `import` statements so TypeScript does not downlevel them into CommonJS `require` calls.
- Tailwind CSS now runs on **v4.1**. Continue to declare utilities in component `className` strings and keep `tailwind.config.js` focused on design tokens (animations, keyframes, plugins); the new Lightning CSS-powered compiler replaces the old PostCSS pipeline.
- Frontend tooling now targets PostCSS 8.5.x, Autoprefixer 10.4.21, and Prettier 3.6.x. Run `npm ci` after pulling to refresh the lockfile before running Tailwind builds or `npm run format` so the upgraded toolchain is available locally.
- Vite 7.x and `@vitejs/plugin-react` 5.x power the renderer build. Pull the latest dependencies with `npm ci` before running `npm run dev`, and import Flowbite React’s named subcomponents (for example `ModalHeader`, `DropdownItem`, and `AccordionPanel`) directly instead of the deprecated `Modal.Header`/`Dropdown.Item` statics; the legacy `flowbite-compat` shim has been removed.
- Flowbite React 0.12 requires labels to render via children and replaces the `TextInput` `helperText` prop with the standalone `HelperText` component. Mirror the patterns in `GenerateVideoSettingForm` and `useOrganizationModal` when updating forms so UI copy renders consistently in both light and dark modes.
- DOMPurify 3.3.0 ships first-party TypeScript declarations. Remove any lingering `@types/dompurify` references from local scaffolding; the stub package has been deprecated.
- When customising Flowbite dropdown triggers, always provide a descriptive `label`/`aria-label` and set `type="button"` on the trigger element. If a dropdown item exposes inline actions, render it with `as="div"`, apply `role="menuitemradio"`/`aria-checked` for selection state, and reveal icon buttons on both `:hover` and `:focus-within` so keyboard users can reach the controls without encountering nested `<button>` elements.
- The markdown pipeline now relies on `react-markdown@10.x`, which no longer accepts a `className` prop. Wrap markdown renderers in container elements (see `components/Markdown/MD.tsx` and `CodeRenderer.tsx`) when applying layout styles.
- Internationalisation is now handled by `i18next@25.x` and `react-i18next@16.x`. The renderer bootstraps language selection via `resolveInitialLanguage()` in `src/renderer/src/i18n/config.ts`; prefer that helper when adding new entry points or persisting language overrides so unsupported locales gracefully fall back to English.
- The embedded API rate limiting layer and Markdown renderer now rely on `rate-limiter-flexible@8.1.x` and `remark-gfm@4.0.x`. Pin compatible versions if you extend these integrations outside the main Electron bundle.
- Electron packaging now targets `electron-builder` 26.x, `electron-updater` 6.7.x, `electron-vite` 4.x, and `electron-store` 11.x. Run `npm ci` after pulling to refresh the toolchain, and when extending the store configuration helpers import the official `ElectronStore.Options` types instead of reintroducing the legacy `src/types/electron-store.d.ts` shim.
- When adding new `logger.error` or `logger.warn` calls, keep the primary message static and attach dynamic details (IDs, paths, URLs, etc.) via the structured metadata object so logs remain stable across releases.
- Tool and service exceptions now attach sanitised metadata via `Error#cause`. Throw errors with value-stable messages (for example `'Screen capture permission denied'` or `'Image file not found'`) and stash dynamic context—sanitised file names, provider reasons, byte counts—inside the `cause` object so downstream logs and tool wrappers stay deterministic.
- In preload and renderer code, route errors and warnings through the shared logging bridge (`preloadLogger`, `rendererLogger`, or `window.logger`) instead of `console.error`/`console.warn` so metadata can be sanitised before it reaches the main process.
- Logger fallbacks now redact structured metadata before printing to the console, so avoid embedding literal values (such as specific years or quota numbers) in the primary message text—surface them through metadata instead.
- Jest test runs install a buffered console writer (see `src/test/setup/logging.ts`) so log noise stays out of CI output; use `getLoggerBuffer()` or `createBufferedConsoleWriter()` when you need to assert against sanitised payloads.
- All Jest scripts (`npm test`, `npm run test:watch`, and integration variants) now execute through `scripts/run-jest.mjs`, which checks for required dev dependencies before spawning the CLI and exits with a remediation hint when the jsdom environment package or `babel-jest` transformer is missing.
- MCP IPC handlers now rely on the shared logger and static message strings. When extending the IPC surface, keep primary messages value-agnostic and move request context (tool names, server counts, etc.) into metadata.
- Real-time streaming hooks (renderer socket bridges, Speak page audio worklets, Nova streaming clients) must log connection IDs, durations, and tool identifiers through metadata only. Keep the primary message constant so rapid event loops do not leak raw payloads into production logs.
- The Nova Sonic bidirectional streaming client now emits static error messages for session lifecycle and tool-handling failures. Inspect the `error.cause` payload (`sessionId`, `causeName`, `causeMessage`, and reason flags) when diagnosing retries or renderer notifications instead of parsing interpolated message strings.
- Nova Sonic region availability and connectivity endpoints share the constants in `src/common/sonic/regions.ts`. Keep response `error` fields fixed to the exported strings and inspect metadata for request-specific diagnostics when troubleshooting region mismatches or API failures.
- `npm run lint:logs` enforces the static-message policy for `warn`/`error` calls on any logger (including the shared root logger `log` and the global `console`) across both the application sources under `src/` and the build/maintenance scripts under `scripts/`. The command runs as part of `npm run lint` and fails if a template literal or variable is passed as the primary message—move runtime context into metadata instead.
- When you need to attach context to a warning or error, wrap values in a metadata object (for example `log.error('Failed to fetch tools', { error })`). Passing bare values like `log.error('Failed', error)` will be sanitised under anonymous keys (`meta_0`), making it harder to trace issues in production logs.
- Validation helpers such as `ensureValidStorageKey` and `coerceAwsCredentials` now throw structured errors (`StorageKeyValidationError`, `AwsCredentialSanitizationError`) with static messages. Inspect `error.code` and `error.metadata` instead of parsing message strings when handling validation failures.
- Configuration store sanitisation helpers (`sanitizeProjectPathValue`, `sanitizeProxyConfiguration`, `sanitizeTavilyApiKey`, and the `store` getters/setters) now emit structured `StoreValidationError`/`StoreStateError` instances. Downstream callers should branch on `error.code` (for example `project_path_empty`, `proxy_missing_required_fields`, or `store_uninitialized`) rather than matching message text, and rely on the `metadata` payload for remediation hints.
- Preload tool error wrappers (`wrapError`, `ToolNotFoundError`, `RateLimitError`) now produce static message strings. Consume the structured metadata (`causeName`, `causeMessage`, `detailMessage`, etc.) when presenting diagnostics or logging follow-up context instead of interpolating tool names or service responses into the primary string.
- Filesystem automation tools (`writeToFile`, `copyFile`, `moveFile`, `createFolder`, `applyDiffEdit`, and `readFiles`/`listFiles`) emit static `Tool execution failed.` messages backed by reason codes such as `WRITE_FILE_FAILED`, `FILE_TOO_LARGE`, and `READ_PDF_FAILED`. Inspect the accompanying `error.metadata` object for hashed paths, byte counts, and detail strings instead of relying on message parsing.
- Code Interpreter asynchronous task APIs now expose structured `errorInfo` payloads (`message`, `code`, and `metadata`) on both task snapshots and list results. Downstream consumers should display these structured fields rather than parsing `task.error` strings, and keep any follow-up logging value-agnostic by echoing only the metadata object.
- The desktop `CommandService` now raises `CommandServiceError` instances with static message strings (for example `'Command execution failed.'` or `'Command execution timed out.'`). When handling CLI results, inspect `error.code` and `error.metadata` rather than parsing message text so hashed command summaries and cwd details stay in metadata.
- Background agent session helpers and schedulers emit `BackgroundAgentError` instances for persistence, cron validation, and lookup failures (for example `background_session_write_failed`, `background_cron_expression_invalid`, or `background_agent_not_found`). When handling these flows, branch on `error.code` and surface remediation hints from `error.metadata` instead of relying on interpolated message strings.
- Dashboard analytics now ship with `chart.js@4.5.1`; run `npm ci` to refresh the dependency if charts fail to render after pulling the latest changes.
- PDF IPC handlers (`pdf-extract-text`, `pdf-extract-metadata`, `pdf-get-info`) now raise `PdfProcessingError` codes such as `PDF_FILE_TOO_LARGE`, `PDF_PARSE_FAILED`, and `PDF_TEXT_EXTRACTION_FAILED`. Renderer bridges should branch on `error.code`/`error.metadata` to present hashed path summaries, byte-length placeholders, and validated line-range context instead of relying on message strings.
- The PDF toolchain now defends against stale `pdf-parse` installs via an internal adapter that memoises parse results and wraps the async default export. If the bridge cannot resolve the parser you will receive `error.metadata.reason === 'parser_initialization_failed'` alongside a remediation hint (`npm ci`), so refresh your dependencies to ensure version 2.3.11 APIs are present before debugging further. Transient parsing failures automatically clear the cached promise—call `resetPdfParseCacheForTests()` inside Jest suites that stub `pdf-parse` so retries pick up your latest mock implementation.
- `COMMAND_WORKDIR_RESOLUTION_FAILED` responses hash the rejected working directory before attaching it to `error.metadata`, and `stopProcess` now falls back to direct child termination on Windows while treating missing processes (`ESRCH`) as a successful no-op. Consumers should continue to rely on the structured metadata rather than logging raw cwd values or assuming negative PIDs are available on every platform.
- Legacy sandbox Jest fixtures have been removed. Use the curated unit and integration suites (plus the buffered logging helpers under `src/test/setup/logging.ts`) when experimenting locally.
- Before committing tests, ensure there are no focused suites (`describe.only`) or specs (`test.only`/`it.only`). They silently bypass the broader Jest suite and will cause CI to miss regressions.
- Prompt cache handling and session cost reporting now rely on the shared `PromptCacheManager` and `PricingCalculator` utilities. Reuse these helpers instead of duplicating ad-hoc implementations when touching chat-related code.
- Sample Python directory agents now log through the `_format_log_summary` helper so CloudWatch entries stay free of raw payloads; mirror this approach when adding new non-TypeScript runtimes.
- The native dependency rebuild helper now lives in `scripts/rebuild-native-deps.mjs`. It cleans stale `.app-builder-bin-*` caches before invoking `electron-builder install-app-deps`, exposes `npm run rebuild:native` for manual retries when lifecycle scripts are skipped, and ships `npm run clean:native` for purging caches when the installer reports an `ENOTEMPTY` rename failure.
- AWS Bedrock service clients and the Model Context Protocol SDK are pinned to the latest 3.910.x/1.20.x releases to pick up October 2025 security fixes—run `npm ci` after pulling to refresh the lockfile.


### URL Allowlist

Bedrock Engineer restricts external navigation to a configurable set of hosts.
Customize this list by setting the `ALLOWED_HOSTS` environment variable to a
comma-separated list of hostnames (for example,
`ALLOWED_HOSTS=github.com,example.com`). If not provided, the application
defaults to allowing only `github.com`.

### Trusted API endpoint sanitisation

The renderer, preload bridge, and embedded Express server now share a common
normalisation layer for local API endpoints. When you set
`ELECTRON_RENDERER_URL`, `ALLOWED_ORIGINS`, or update the `apiEndpoint` value in
the encrypted store, the application:

- rejects endpoints with embedded credentials, paths, query strings, or hash
  fragments;
- forces HTTPS for remote hosts and only permits HTTP when the hostname resolves
  to a loopback interface (including IPv6 `http://[::1]:…`);
- lowercases the protocol and host so equality comparisons remain predictable.

If an endpoint fails validation it will be ignored and a warning is logged. This
prevents poisoned configuration from exposing the local API over insecure
transports. Use the in-app settings page or set the `apiEndpoint` via `window.store`
only with trusted values that meet these constraints.

### API authentication & origin security

The embedded Express + Socket.IO API now requires an authentication token for
all requests and websocket connections. During startup Bedrock Engineer will:

1. Register the environment token digest when `API_AUTH_TOKEN_SHA256` is set,
   allowing CI/CD pipelines to avoid injecting plaintext credentials.
2. Otherwise read the `API_AUTH_TOKEN` environment variable if it is present.
3. If neither value exists, generate a 256-bit random token, persist it in the
   encrypted application store, and share it with the renderer process.

Every HTTP call issued by the renderer automatically sends this token via the
`X-API-Key` header, and Socket.IO uses it during the connection handshake. If
you run external tooling that talks to the local API, set either
`API_AUTH_TOKEN_SHA256` (preferred) or `API_AUTH_TOKEN` explicitly so that the
same secret is recognised on every request without leaking the token value to
logs or process explorers.

For additional protection the backend enforces a strict CORS allowlist. Use the
`ALLOWED_ORIGINS` environment variable to provide a comma-separated list of
allowed HTTPS origins. Plain-HTTP localhost origins are accepted only during
development. Production builds served from the bundled `file://` protocol are
whitelisted automatically. The same allowlist now governs renderer navigation
and permission prompts: any attempt to navigate the Electron windows to an
untrusted origin, open a `<webview>`, or request camera/microphone access from a
non-allowlisted origin is denied and logged by the main process.

Electron permission handling is likewise locked down. Only clipboard
operations, fullscreen requests, and audio/video capture originating from a
trusted origin are granted. Everything else is rejected automatically, which
prevents malicious content from escalating privileges if it ever reached the
renderer sandbox.

The embedded HTTP server now binds exclusively to `127.0.0.1`, preventing
remote hosts on the local network from reaching the API unless you explicitly
reverse-proxy it. If you do place Bedrock Engineer behind a trusted proxy and
need to honour `X-Forwarded-For` headers for websocket rate limiting, set
`TRUST_PROXY_FOR_SOCKETS=true`. Leaving the flag unset instructs the server to
ignore forwarded addresses and rely on the direct socket IP, which is the safer
default for desktop deployments.

### Health monitoring

Operational tooling can poll `GET /healthz` (or `HEAD /healthz`) without an authentication token.
The endpoint returns a JSON payload that includes the overall health status (`ok`, `degraded`, or `error`),
process uptime, and component-level diagnostics for the configuration store and API authentication token.
Requests that surface a degraded or error state emit structured log entries with the same metadata so the
application log stream mirrors health-check behaviour.

Kubernetes-style readiness checks are exposed via `GET /readyz` (and `HEAD /readyz`). This endpoint blocks until the
encrypted configuration store is reachable and emits a `503` response whenever dependent subsystems report an
`initializing` or `error` state. Readiness responses mirror health logging semantics so the structured log stream carries the
same `status`/`healthStatus` metadata.

Prometheus-compatible metrics are published at `GET /metrics` (API token required). The registry exports latency histograms
and request counters tagged with HTTP method, resolved route, status code, and outcome classification. Configure the
collector to supply a static `X-API-Key` header so metrics scraping remains authenticated.

Every API response now includes an `X-Request-Id` header. Downstream callers may forward their own value (restricted to
`[A-Za-z0-9_.-]`) to correlate cross-service traces; otherwise a UUID v4 is generated automatically. The correlation ID,
OpenTelemetry trace ID, and span ID are attached to every structured log entry emitted while processing the request. To export
traces, set `OTEL_EXPORTER_OTLP_ENDPOINT` (and optional `OTEL_EXPORTER_OTLP_HEADERS`) before launching the app—spans are batched
to the configured OTLP HTTP collector. If tracing is not required, leave the environment variables unset and the provider will
operate with in-memory spans only.


## Agent Chat

The autonomous AI agent capable of development assists your development process. It provides functionality similar to AI assistants like [Cline](https://github.com/cline/cline), but with its own UI that doesn't depend on editors like VS Code. This enables richer diagramming and interactive experiences in Bedrock Engineer's agent chat feature. Additionally, with agent customization capabilities, you can utilize agents for use cases beyond development.

- 💬 Interactive chat interface with human-like Amazon Nova, Claude, and Meta llama models
- 📁 File system operations (create folders, files, read/write files)
- 🔍 Web search capabilities using Tavily API
- 🏗️ Project structure creation and management
- 🧐 Code analysis and improvement suggestions
- 📝 Code generation and execution
- 📊 Data analysis and visualization
- 💡 Agent customization and management
- 🛠️ Tool customization and management
- 🔄 Chat history management
- 🌐 Multi-language support
- 🛡️ Guardrail support
- 💡 Light processing model for cost optimization

| ![agent-chat-diagram](./assets/agent-chat-diagram.png) | ![agent-chat-search](./assets/agent-chat-search.png) |
| :----------------------------------------------------: | :--------------------------------------------------: |
|             Code analysis and diagramming              |       Web search capabilities using Tavily API       |

### Select an Agent

Choose an agent from the menu in the top left. By default, it includes a Software Developer specialized in general software development, a Programming Mentor that assists with programming learning, and a Product Designer that supports the conceptual stage of services and products.

![select-agents](./assets/select-agents.png)

### Customize Agents

Enter the agent's name, description, and system prompt. The system prompt is a crucial element that determines the agent's behavior. By clearly defining the agent's purpose, regulations, role, and when to use available tools, you can obtain more appropriate responses.

![custom-agents](./assets/custom-agents.png)

### Select Tools / Customize Tools

Click the Tools icon in the bottom left to select the tools available to the agent. Tools can be configured separately for each agent.

![select-tools](./assets/select-tools.png)

The supported tools are:

#### 📂 File System Operations

| Tool Name      | Description                                                                                                                                                                   |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createFolder` | Creates a new directory within the project structure. Creates a new folder at the specified path.                                                                             |
| `writeToFile`  | Writes content to a file. Creates a new file if it doesn't exist or updates content if the file exists.                                                                       |
| `readFiles`    | Reads contents from multiple files simultaneously. Supports text files and Excel files (.xlsx, .xls), automatically converting Excel files to CSV format.                     |
| `listFiles`    | Displays directory structure in a hierarchical format. Provides comprehensive project structure including all subdirectories and files, following configured ignore patterns. |
| `moveFile`     | Moves a file to a different location. Used for organizing files within the project structure.                                                                                 |
| `copyFile`     | Duplicates a file to a different location. Used when file duplication is needed within the project structure.                                                                 |

#### 🌐 Web & Search Operations

| Tool Name      | Description                                                                                                                                                                                                                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tavilySearch` | Performs web searches using the Tavily API. Used when current information or additional context is needed. Requires an API key.                                                                                                                                                                 |
| `fetchWebsite` | Retrieves content from specified URLs. Large content is automatically split into manageable chunks. Initial call provides chunk overview, with specific chunks retrievable as needed. Supports GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS methods with custom headers and body configuration. |

#### 🤖 Amazon Bedrock Integration

| Tool Name            | Description                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `generateImage`      | Generates images using Amazon Bedrock LLMs. Uses stability.sd3-5-large-v1:0 by default and supports both Stability.ai and Amazon models. Supports specific aspect ratios and sizes for Titan models, with PNG, JPEG, and WebP output formats. Allows seed specification for deterministic generation and negative prompts for exclusion elements.                                                            |
| `recognizeImage`     | Analyzes images using Amazon Bedrock's image recognition capabilities. Supports various analysis types including object detection, text detection, scene understanding, and image captioning. Can process images from local files. Provides detailed analysis results that can be used for content moderation, accessibility features, automated tagging, and visual search applications.                    |
| `generateVideo`      | Generates videos using Amazon Nova Reel. Creates realistic, studio-quality videos from text prompts or images. Supports TEXT_VIDEO (6 seconds), MULTI_SHOT_AUTOMATED (12-120 seconds), and MULTI_SHOT_MANUAL modes. Returns immediately with job ARN for status tracking. Requires S3 configuration.                                                                                                         |
| `checkVideoStatus`   | Checks the status of video generation jobs using invocation ARN. Returns current status, completion time, and S3 location when completed. Use this to monitor progress of video generation jobs.                                                                                                                                                                                                             |
| `downloadVideo`      | Downloads completed videos from S3 using invocation ARN. Automatically retrieves S3 location from job status and downloads to specified local path or project directory. Only use when checkVideoStatus shows status as "Completed".                                                                                                                                                                         |
| `retrieve`           | Searches information using Amazon Bedrock Knowledge Base. Retrieves relevant information from specified knowledge bases.                                                                                                                                                                                                                                                                                     |
| `invokeBedrockAgent` | Interacts with specified Amazon Bedrock Agents. Initiates dialogue using agent ID and alias ID, with session ID for conversation continuity. Provides file analysis capabilities for various use cases including Python code analysis and chat functionality.                                                                                                                                                |
| `invokeFlow`         | Executes Amazon Bedrock Flows for custom data processing pipelines. Supports agent-specific flow configurations and multiple input data types (string, number, boolean, object, array). Enables automation of complex workflows and customized data processing sequences with flexible input/output handling. Ideal for data transformation, multi-step processing, and integration with other AWS services. |

#### 💻 System Command & Code Execution

| Tool Name         | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `executeCommand`  | Manages command execution and process input handling. Features two operational modes: 1) initiating new processes with command and working directory specification, 2) sending standard input to existing processes using process ID. For security reasons, only allowed commands can be executed, using the configured shell. Unregistered commands cannot be executed. The agent's capabilities can be extended by registering commands that connect to databases, execute APIs, or invoke other AI agents.                    |
| `codeInterpreter` | Executes Python code in a secure Docker environment with pre-installed data science libraries. Provides isolated code execution with no internet access for security. Supports two environments: "basic" (numpy, pandas, matplotlib, requests) and "datascience" (full ML stack including scikit-learn, scipy, seaborn, etc.). Input files can be mounted read-only at /data/ directory for analysis. Generated files are automatically detected and reported. Perfect for data analysis, visualization, and ML experimentation. |
| `screenCapture`   | Captures the current screen and saves as PNG image file. Optionally analyzes the captured image with AI using vision models (Claude/Nova) to extract text content, identify UI elements, and provide detailed visual descriptions for debugging and documentation purposes. Platform-specific permissions required (macOS: Screen Recording permission in System Preferences required).                                                                                                                                          |
| `cameraCapture`   | Captures images from PC camera using HTML5 getUserMedia API and saves as an image file. Supports different quality settings (low, medium, high) and formats (JPG, PNG). Optionally analyzes the captured image with AI to extract text content, identify objects, and provide detailed visual descriptions for analysis and documentation purposes. Camera access permission is required in your browser settings.                                                                                                               |

<details>
<summary>Tips for Integrate Bedrock Agents</summary>

### Agent Preparation Toolkit (APT)

You can get up and running quickly with Amazon Bedrock Agents by using the [Agent Preparation Toolkit](https://github.com/aws-samples/agent-preparation-toolkit).

</details>

### MCP (Model Context Protocol) Client Integration

Model Context Protocol (MCP) client integration allows Bedrock Engineer to connect to external MCP servers and dynamically load and use powerful external tools. This integration extends the capabilities of your AI assistant by allowing it to access and utilize the tools provided by the MCP server.

For detailed information about MCP server configuration, see the [MCP Server Configuration Guide](./docs/mcp-server/MCP_SERVER_CONFIGURATION.md).

## Background Agent

Schedule AI agent tasks to run automatically at specified intervals using cron expressions. Background Agent enables continuous workflow automation with real-time execution notifications.

![background-agent](./assets/background-agent.png)

### Key Features

- 🕒 **Scheduled Execution**: Automate tasks using cron expressions (hourly, daily, weekly, etc.)
- 🔄 **Session Continuity**: Maintain conversation context across task executions
- ⚡ **Manual Execution**: Run tasks immediately when needed
- 📊 **Execution Tracking**: Monitor task history and performance
- 🔔 **Real-time Notifications**: Get instant feedback on task results

## Agent Directory

The Agent Directory is a content hub where you can discover and immediately use AI agents created by skilled contributors. It offers a curated collection of pre-configured agents designed for various tasks and specialties.

![agent-directory](./assets/agent-directory.png)

### Features

- **Browse the Collection** - Explore a growing library of specialized agents created by the community
- **Search & Filter** - Quickly find agents using the search function or filter by tags to discover agents that match your needs
- **Detailed Information** - View comprehensive information about each agent including author, system prompt, supported tools, and usage scenarios
- **One-Click Addition** - Add any agent to your personal collection with a single click and start using it immediately
- **Contribute Your Agents** - Share your custom agents with the community by becoming a contributor

### Using the Agent Directory

1. **Browse and Search** - Use the search bar to find specific agents or browse the entire collection
2. **Filter by Tags** - Click on tags to filter agents by categories, specialties, or capabilities
3. **View Details** - Select any agent to view its complete system prompt, supported tools, and usage scenarios
4. **Add to Your Collection** - Click "Add to My Agents" to add the agent to your personal collection

### Organization Sharing

Share agents within your team or organization using AWS S3 storage. This feature enables:

- **Team Collaboration** - Share custom agents with specific teams or departments
- **Centralized Management** - Manage organization-specific agents through S3 buckets

For detailed setup instructions, see the [Organization Sharing Guide](./docs/agent-directory-organization/).

### Contribute Your Agents

Become a contributor and share your custom agents with the community:

1. Export your custom agent as a shared file
2. Add your GitHub username as the author
3. Submit your agent via Pull Request or GitHub Issue

By contributing to the Agent Directory, you help build a valuable resource of specialized AI agents that enhance the capabilities of Bedrock Engineer for everyone.

## Nova Sonic Voice Chat

Real-time voice conversation feature powered by Amazon Nova Sonic. Engage in natural voice interactions with AI agents.

![voice-chat-page](./assets/voice-chat-page.png)

### Key Features

- 🎤 **Real-time Voice Input**: Natural conversation with AI using your microphone
- 🗣️ **Multiple Voice Selection**: Choose from 3 voice characteristics
  - Tiffany: Warm and friendly
  - Amy: Calm and composed
  - Matthew: Confident and authoritative
- 🤖 **Agent Customization**: Custom agents available just like Agent Chat
- 🛠️ **Tool Execution**: Agents can execute tools during voice conversations
- 🌐 **Multi-language Support**: Currently supports English only, with plans for other languages

Nova Sonic Voice Chat provides a more natural and intuitive AI interaction experience, different from traditional text-based exchanges. Voice communication enables efficient and approachable AI assistant experiences.

### Resolving Duplicate Permission Dialogs

If you experience duplicate OS permission dialogs (such as microphone access), you can resolve this issue by running the following command after building and installing the application to add an ad-hoc signature:

```bash
sudo codesign --force --deep --sign - "/Applications/Bedrock Engineer.app"
```

This command applies an ad-hoc code signature to the application, which helps prevent duplicate system permission dialogs.

## Website Generator

Generate and preview website source code in real-time. Currently supports the following libraries, and you can interactively generate code by providing additional instructions:

- React.js (w/ Typescript)
- Vue.js (w/ Typescript)
- Svelte.js
- Vanilla.js

Here are examples of screens generated by the Website Generator:

| ![website-gen](./assets/website-generator.png) | ![website-gen-data](./assets/website-generator-data-visualization.png) | ![website-gen-healthcare](./assets/website-generator-healthcare.png) |
| :--------------------------------------------: | :--------------------------------------------------------------------: | :------------------------------------------------------------------: |
|          House Plant E-commerce Site           |                           Data Visualization                           |                           Healthcare Blog                            |

The following styles are also supported as presets:

- Inline styling
- Tailwind.css
- Material UI (React mode only)

### Agentic-RAG (Connect to Design System Data Source)

By connecting to Amazon Bedrock's Knowledge Base, you can generate websites referencing any design system, project source code, or website styles.

You need to store source code and crawled web pages in the knowledge base in advance. When registering source code in the knowledge base, it is recommended to convert it into a format that LLM can easily understand using methods such as [gpt-repository-loader](https://github.com/mpoon/gpt-repository-loader). Figma design files can be referenced by registering HTML and CSS exported versions to the Knowledge Base.

Click the "Connect" button at the bottom of the screen and enter your knowledge base ID.

### Web Search Agent

Website Generator integrates a code generation agent that utilizes web search capabilities. This feature allows you to generate more sophisticated websites by referencing the latest library information, design trends, and coding best practices. To use the search functionality, click the "Search" button at the bottom of the screen to enable it.

## Step Functions Generator

Generate AWS Step Functions ASL definitions and preview them in real-time.

![step-functions-generator](./assets/step-functions-generator.png)

## Diagram Generator

Create AWS architecture diagrams with ease using natural language descriptions. The Diagram Generator leverages Amazon Bedrock's powerful language models to convert your text descriptions into professional AWS architecture diagrams.

Key features:

- 🏗️ Generate AWS architecture diagrams from natural language descriptions
- 🔍 Web search integration to gather up-to-date information for accurate diagrams
- 💾 Save diagram history for easy reference and iteration
- 🔄 Get intelligent recommendations for diagram improvements
- 🎨 Professional diagram styling using AWS architecture icons
- 🌐 Multi-language support

The diagrams are created using draw.io compatible XML format, allowing for further editing and customization if needed.

![diagram-generator](./assets/diagram-generator.png)

## Application Inference Profiles

Bedrock Engineer supports AWS Bedrock Application Inference Profiles for detailed cost tracking and allocation. You can create custom inference profiles with tags to track costs by project, department, or use case.

For detailed setup instructions and examples, see:

- [Application Inference Profile Guide (English)](./docs/inference-profile/INFERENCE_PROFILE.md)

## Documentation

Detailed documentation is available for advanced features and configuration methods of Bedrock Engineer:

- [Custom Model Import Configuration Guide](./docs/custom-model-import/README.md) - How to configure custom models imported using Amazon Bedrock's Custom Model Import feature for use with Bedrock Engineer
- [MCP Server Configuration Guide](./docs/mcp-server/MCP_SERVER_CONFIGURATION.md) - How to configure Model Context Protocol (MCP) servers
- [Organization Sharing Guide](./docs/agent-directory-organization/README.md) - How to set up agent sharing within organizations in Agent Directory

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=aws-samples/bedrock-engineer&type=Date)](https://star-history.com/#aws-samples/bedrock-engineer&Date)

## Security

The local API surface is hardened with multiple layers of protection:

* **Prototype pollution guard** – incoming JSON and form payloads are scanned for `__proto__`,
  `constructor`, and `prototype` keys. Requests containing those keys are rejected with HTTP 400 before
  they reach any business logic.
* **Socket.IO hardening** – all websocket connections must originate from an allow‑listed origin,
  authenticate with the shared API token, and respect sequential audio processing enforced by the
  streaming queue. Connections that exceed per‑IP rate limits or attempt to send payloads larger than
  `MAX_AUDIO_PAYLOAD_BYTES` are disconnected.
* **Standardised rate limiting responses** – HTTP clients now receive structured JSON errors together
  with RFC 9110 compatible `RateLimit-*` headers, simplifying automated backoff.
* **Structured API error payloads** – REST endpoints and streaming sockets now emit static messages with
  stable `code` plus optional `metadata` and `referenceId` fields. Inspect these structured fields instead
  of parsing message text when handling failures. Every error response also carries an `X-Request-Id`
  header that matches the payload `referenceId`, making it easy to correlate client-side telemetry with
  backend logs.
* **Strict HTTP headers** – the API disables the Express `X-Powered-By` header, adds modern Helmet
  defaults (including `Referrer-Policy: no-referrer`) and publishes a restrictive `Permissions-Policy`
  (`camera=(), microphone=(), geolocation=()`).
* **Fetch metadata enforcement** – requests that arrive with `Sec-Fetch-Mode` outside `cors`/`same-origin`,
  cross-site `Sec-Fetch-Site`, or non-empty destinations are rejected before they reach business logic.
  File and `app://` origins are only honoured when browsers report an `empty` destination, preventing
  `<iframe>` or `<img>` abuse of the local API.
* **No-store caching** – every response carries `Cache-Control: no-store, no-cache, must-revalidate`
  alongside legacy `Pragma`/`Expires` headers so that intermediaries and browsers do not persist sensitive
  Bedrock results or AWS credentials.
* **Restricted disk outputs** – screenshot, camera capture, website download, Bedrock media, and Nova
  Sonic image generation routines all enforce allow‑listed directories (project workspace, application
  data, OS downloads/pictures, or temp folders). Attempts to read from or write to arbitrary paths are
  rejected before any file system access occurs.

### Configurable security knobs

| Variable | Default | Description |
| --- | --- | --- |
| `SOCKET_MAX_HTTP_BUFFER_SIZE` | `1048576` | Maximum HTTP upgrade payload accepted by Socket.IO (bytes). |
| `SOCKET_PING_TIMEOUT_MS` | `20000` | Milliseconds to wait for a ping/pong acknowledgement before closing a socket. |
| `SOCKET_PING_INTERVAL_MS` | `25000` | Milliseconds between ping frames. |
| `AUDIO_RATE_LIMIT_POINTS` | `120` | Number of audio chunks allowed per client within the configured window. |
| `AUDIO_RATE_LIMIT_WINDOW_SEC` | `60` | Rate limit window for audio chunks (seconds). |
| `MAX_AUDIO_PAYLOAD_BYTES` | `1048576` | Maximum size for a single audio chunk emitted by the renderer (bytes). |
| `MAX_REQUESTS_PER_SOCKET` | `100` | Maximum HTTP requests permitted on a single keep-alive connection before it is recycled. |
| `TRUST_PROXY` | `false` | When set to `true`, Express honours `X-Forwarded-*` headers from trusted proxies for rate limiting and logging. |
| `TRUST_PROXY_TRUSTED_ADDRESSES` | `loopback, linklocal, uniquelocal` | Optional comma-separated list passed to `app.set('trust proxy', ...)` when `TRUST_PROXY=true`. |

Update the relevant environment variables when you need to loosen or tighten the defaults for local
testing. Remember to keep renderer and main‑process configuration in sync when changing the limits.

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for information on reporting
vulnerabilities.

## License

This library is licensed under the MIT-0 License. See the LICENSE file.

This software uses [Lottie Files](https://lottiefiles.com/free-animation/robot-futuristic-ai-animated-xyiArJ2DEF).
