# Secret management

Bedrock Engineer stores application settings in an encrypted [electron-store](https://github.com/sindresorhus/electron-store) database. The encryption key is stored in the operating system keychain via [`keytar`](https://github.com/atom/node-keytar).

## How it works

1. On first launch the app looks for a store encryption key in the keychain.
2. If none is found, a new random key is generated and saved with the service name `bedrock-engineer`.
3. Any existing plaintext configuration is migrated and written back using the new key.
4. Subsequent runs load the key from the keychain and transparently decrypt the store.

If the operating system keychain is unavailable (for example on hardened Linux
desktops without a keyring daemon), Bedrock Engineer now falls back to storing
the encryption key in a `secure-store.key` file next to the encrypted
configuration. The file is created with `0700/0600` permissions and only after
keychain access fails, ensuring credentials remain protected while the
application continues to start. Removing the keytar entry or the fallback file
forces a new key to be generated on the next run.

## API authentication token

The authentication token that protects the embedded Express and Socket.IO
endpoints (`apiAuthToken`) is persisted in the same encrypted store. When you
provide an explicit `API_AUTH_TOKEN` environment variable it is synchronised
into the store; otherwise a random value is generated, saved, and reused across
app restarts. Because both the store and the token are encrypted at rest, the
token is not exposed on disk and can safely be shared with the renderer via the
preload bridge.

> **Minimum token strength**: When overriding `API_AUTH_TOKEN` yourself, use a
> value that is at least 32 characters long and limited to URL-safe characters
> (`A-Za-z0-9+_.=-`). We ignore weaker values and fall back to a securely
> generated token to prevent accidental weakening of the local API surface.

If you would prefer not to place plaintext secrets in the process environment,
export the `API_AUTH_TOKEN_SHA256` variable with the token's hexadecimal
SHA-256 digest instead. The backend registers the hashed value, ignores any
plaintext `API_AUTH_TOKEN`, and compares incoming credentials by hashing the
presented token. This keeps CI/CD logs, environment dumps, and local process
inspectors free of the raw secret while preserving the same authentication
semantics. The application removes the `API_AUTH_TOKEN` entry from the process
environment and purges any stored plaintext token when a valid digest is
present so spawned child processes cannot accidentally inherit the secret nor
leave it persisted at rest. If the store still contains a plaintext token when
the digest override is detected, `/healthz` reports the store source as weak to
prompt operational cleanup.

## External secrets managers

When `API_AUTH_SECRET_ID` is configured you **must** set `SECRETS_DRIVER` to one
of the supported providers. If the variable is missing the runtime records an
error and, when possible, logs a single warning with the provider it detected
from the surrounding environment (Vault signals take priority over AWS). The
service refuses to contact any secrets backend until `SECRETS_DRIVER` is
explicitly provided, keeping Zero-Trust boundaries intact and ensuring the
health report reflects the intended provider.

### AWS Secrets Manager

Set `SECRETS_DRIVER=aws-secrets-manager` (or `aws`) and provide
`API_AUTH_SECRET_ID` along with the optional `API_AUTH_SECRET_REGION` and
`API_AUTH_SECRET_ENDPOINT` overrides. The helper honours
`API_AUTH_SECRET_CACHE_SECONDS` to reduce API calls and surfaces structured
errors (`retryAfterSeconds`) when the SDK is throttled. All lookups are hashed
and audited via the `security:audit` logger.

### HashiCorp Vault

Set `SECRETS_DRIVER=hashicorp-vault` (or `vault`) and configure:

* `SECRETS_VAULT_ADDR` – Vault base URL.
* `SECRETS_VAULT_NAMESPACE` – optional namespace header.
* `SECRETS_VAULT_AUTH_METHOD` – `approle` (default) or `jwt`.
  * AppRole: `SECRETS_VAULT_APPROLE_ROLE_ID` and `SECRETS_VAULT_APPROLE_SECRET_ID`.
  * JWT: `SECRETS_VAULT_JWT_ROLE` plus either `SECRETS_VAULT_JWT` or
    `SECRETS_VAULT_JWT_FILE` pointing at an ephemeral OIDC token.
* `SECRETS_VAULT_AUTH_MOUNT` – custom auth mount path when not using the
  defaults (`auth/approle` or `auth/jwt`).
* `SECRETS_VAULT_TOKEN_RENEW_WINDOW_SECONDS` – optional safety margin before
  cached tokens are re-authenticated.
* `API_AUTH_SECRET_FIELD` – optional KV field containing the JSON payload. When
  omitted the entire `data` object is serialised.

Vault logins and secret reads are hashed and written to the `security:audit`
stream so downstream collectors can retain 90-day access logs. Any configuration
error is logged once with a fixed reason code to keep runbooks actionable.

GitHub Actions assumes the short-lived IAM role provided via repository secrets
(`AWS_ROLE_TO_ASSUME`, `AWS_REGION`) using OpenID Connect before executing the
verification, DAST, and deployment preparation jobs. Local development can rely
on the same flow by exporting `AWS_PROFILE` or running `aws sts assume-role`
manually. Rotate the IAM role at least quarterly and ensure the linked policy
restricts access to the specific `API_AUTH_SECRET_ID` resource. For Vault flows
issue short-lived AppRole or OIDC tokens and rotate them via the runbook in
`docs/runbooks/rotate-secrets.md`.

## Tavily API key and endpoint validation

Tavily search credentials (`tavilySearch.apikey`) are now validated before they
are written to disk. Only keys that match the documented `tvly-…` format are
accepted; blank values remove the key from the store. Unexpected formats raise a
validation error so misconfigured secrets do not persist silently.

Similarly, the `apiEndpoint` value is normalised with the same guardrails used
by the main process. Endpoints that include credentials, path fragments, or
unsafe schemes are rejected to ensure the renderer can only connect to trusted
loopback or HTTPS origins.

## Inspecting the encrypted store during development

The upgrade to `electron-store` 11.x exposes an `openInEditor()` helper that
launches the active configuration file in your default editor without breaking
encryption at rest. When you need to inspect local state, import the shared
store wrapper and call the helper from a development-only script or the Node
REPL:

```ts
import { store } from '../preload/store'

await store.openInEditor()
```

If the operating system refuses to launch the editor (for example when sandbox
policies block the request), the preload layer raises a structured
`StoreInspectorError` with static messaging and metadata containing the
sanitised failure reason. This keeps log output compliant with the
redaction policy while still surfacing actionable diagnostics.
