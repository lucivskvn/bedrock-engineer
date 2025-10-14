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
