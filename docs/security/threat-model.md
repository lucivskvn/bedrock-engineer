# Bedrock Engineer Threat Model

## System overview

Bedrock Engineer is an Electron-based desktop application that exposes a local
Express API (`/healthz`, `/readyz`, `/metrics`, `/converse/stream`, etc.), Socket.IO
channels, and renderer functionality for automating software engineering tasks
using Amazon Bedrock. Sensitive credentials (Bedrock keys, Tavily tokens, API
auth tokens) are resolved from environment variables, external secret managers,
or the encrypted Electron store.

## Assets

| Asset | Description | Notes |
| --- | --- | --- |
| API auth tokens | Protect access to local API, socket, and automation actions | Stored hashed/in secret manager |
| Bedrock credentials | Allow LLM access and resource manipulation | Retrieved from AWS federation |
| Electron store data | Contains agent configuration, secret references | AES-encrypted and gated by OS keychain |
| User source code | Filesystem content manipulated by the agent | Accessed via local Node APIs |
| Audit/metrics data | Structured logs and Prometheus metrics | Exported via JSON logging and `/metrics` |

## Actors

| Actor | Capabilities | Trust zone |
| --- | --- | --- |
| End user | Launches desktop app, configures agents | Trusted workstation |
| Attacker on workstation | May read environment variables, inspect processes | Untrusted |
| Remote attacker | Sends crafted API requests via exposed endpoints | Untrusted |
| External services | AWS Secrets Manager, HashiCorp Vault, Bedrock | Conditionally trusted |

## Trust zones & boundaries

1. **Renderer sandbox** – communicates with main process via preload bridges. No
   direct filesystem/network access without exposed APIs.
2. **Main process** – Node.js runtime hosting Express API, metrics, and secret
   integrations. Runs under the user's OS account.
3. **External secret manager** – AWS or Vault reachable over TLS.
4. **CI runners** – GitHub-hosted runners assume IAM/Vault roles via OIDC.

Primary trust boundaries include renderer ⇄ main IPC, localhost API ⇄ remote
clients, and main process ⇄ external secret providers.

## Data flows

1. **Authentication**: Clients provide API token via `X-API-Key` or `Authorization`
   headers. Token registry composes environment, store, and secret manager tokens
   and exposes health metadata.
2. **Secret resolution**: On startup, the main process resolves secrets via the
   configured driver (`aws-secrets-manager` or `hashicorp-vault`). When the
   driver is unset the runtime refuses to fetch secrets, emitting an error and a
   single warning that suggests the likely provider inferred from environment
   signals. Results are cached in-memory with TTLs and audited.
3. **Logging/metrics**: Requests flow through correlation middleware that emits
   JSON logs (with `security:audit` category for secret access) and Prometheus
   metrics exported on `/metrics`.
4. **Renderer commands**: Renderer issues IPC calls through preload tools; main
   process enforces static log messages and sanitises filesystem paths.

## Attack surface & mitigations

| Threat | Mitigation |
| --- | --- |
| Token brute force | Tokens require ≥32 chars, rate limiting via `express-rate-limit`, constant-time comparisons |
| Secret leakage through env | SHA-256 digests, secret manager integration, CI static-secret check |
| Compromised secret manager credentials | Short-lived AWS/Vault tokens, audit logging, Vault token renewal |
| Renderer compromise | Preload enforces static messaging, sanitised paths, limited APIs |
| API abuse | RBAC enforcement, health reporting of weak tokens, metrics & alerting |
| Supply chain tampering | `npm audit`, license allow-list, SBOM generation, CI scanning |

## Residual risks & assumptions

* Workstation compromise still exposes decrypted store contents once the user is
  logged in; rely on OS hardening and disk encryption.
* Renderer-originated actions assume the renderer bundle remains trusted; supply
  chain controls mitigate but cannot eliminate malicious extension risk.
* External secret manager availability is critical. Alerts are configured to
  page operations when secret fetch failures persist beyond the retry window.
* Vault/AppRole secrets must be rotated by operations using the runbook in
  `docs/runbooks/rotate-secrets.md`.

## Validation & maintenance

* Revisit this threat model quarterly or after major architectural changes.
* Ensure new endpoints include RBAC, structured logging, and metrics coverage.
* Update attack surface analysis when integrating additional external services
  (e.g., new LLM providers, payment processors).
