# Secret Rotation Runbook

## Purpose

Provide a repeatable procedure for rotating API authentication tokens and Vault
AppRole/JWT credentials without downtime.

## Preconditions

* `SECRETS_DRIVER` is set to either `aws-secrets-manager` or `hashicorp-vault`.
  (If it is omitted the runtime refuses to contact any provider and only logs a
  single suggestion based on environment signals. Set it explicitly before
  rotation to avoid outages.)
* Operators have access to the required IAM/Vault roles (prefer short-lived
  federation).
* PagerDuty incident is acknowledged (if triggered) and bridge is open.

## AWS Secrets Manager flow

1. Export a temporary AWS session (`aws sts assume-role` or GitHub OIDC token).
2. Run `scripts/check-static-secrets.mjs` locally to ensure no plaintext tokens
   leak during the process.
3. Generate new token material: `openssl rand -base64 48`.
4. Update the secret payload via `aws secretsmanager put-secret-value` with the
   new token (and optionally the SHA-256 digest) while preserving existing
   entries for staged rollout.
5. Confirm rotation via `npm run ci:verify` (locally or in staging) and inspect
   `/healthz` for `api_auth_token_secret_unavailable` absence.
6. Remove the old token from the secret once all instances report the new
   fingerprint.

## HashiCorp Vault flow

1. Authenticate using short-lived credentials:
   * AppRole: `vault write auth/<mount>/login role_id=… secret_id=…`
   * JWT: `vault write auth/<mount>/login role=… jwt=$(cat token.jwt)`
2. Issue dynamic credentials via policy-bound roles where possible.
3. Write the new secret payload to `API_AUTH_SECRET_ID` (KV v2 recommended).
   Include both plaintext token (temporary) and `sha256` digest for migration.
4. If rotating AppRole/JWT secrets:
   * Generate new `secret_id` or OIDC token.
   * Update GitHub encrypted secrets or deployment configuration.
   * Run `npm run security:static-secrets` in CI to confirm no static values are
     reintroduced.
5. Validate `/readyz` and `/metrics` on staging. Monitor `security:audit`
   logs for `vault_secret_fetch_error` entries.
6. Revoke previous tokens: `vault token revoke <old-token>` or `vault write
   auth/<mount>/role/<role>/secret-id-accessor/destroy accessor=<old>`.

## Post-rotation tasks

* Update `docs/observability/slo.md` if error budget burn occurred during the
  rotation window.
* Close PagerDuty incident (if opened) with notes.
* Archive audit evidence (AWS CloudTrail, Vault audit log hashes) for 90 days.
* Schedule the next rotation (quarterly minimum) in the shared calendar.
