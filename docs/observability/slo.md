# Service Level Objectives

## Scope

These SLOs cover the local Express API and Socket.IO surfaces exposed by the
main process when Bedrock Engineer runs in unattended mode (CI-driven or
daemonised deployments). Metrics are emitted via Prometheus on `/metrics`.

## Objectives

| SLI | Metric | Target | Measurement |
| --- | --- | --- | --- |
| Availability | `sum(rate(http_requests_total{job="bedrock-engineer",status!~"5.."}[5m])) / sum(rate(http_requests_total{job="bedrock-engineer"}[5m]))` | ≥ 99.5% rolling 30d | Derived from HTTP status codes (sockets mapped to synthetic HTTP gauge) |
| p95 latency | `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{job="bedrock-engineer"}[5m])) by (le, route))` | ≤ 450 ms for `/converse/stream` | Aggregated per route |
| Error budget | 0.5% over 30d | Burn alerts at 25% (warning) and 50% (critical) budget consumption |

## Alert policy

Alerts are defined in `docs/observability/dashboards/api-service-alerts.json` and
cover:

1. **AvailabilityBudgetBurn** – triggers when the 6h error budget burn rate ≥ 2
   (warning) or 4 (critical).
2. **LatencyP95Degraded** – triggers when p95 latency for `/converse/stream`
   exceeds 450 ms for 15 minutes.
3. **SecretProviderErrors** – triggers when `bedrock_engineer_secret_provider_failures_total`
   records >0 failures for two consecutive scrape intervals.

Critical alerts page PagerDuty (Primary On-call). Warning alerts post to the
`#bedrock-observability` Slack channel. Escalation instructions live in
`docs/runbooks/rotate-secrets.md` and `docs/runbooks/incident-response.md`.

## Dashboards & runbooks

* Grafana dashboards: `docs/observability/dashboards/` (import into Grafana via
  provisioning or UI).
* Runbooks: `docs/runbooks/rotate-secrets.md` (secret rotation) and
  `docs/runbooks/incident-response.md` (incident bridge template).

Review SLO adherence monthly and whenever major architectural changes land.
