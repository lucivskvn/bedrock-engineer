# Incident Response Playbook

## Activation

1. PagerDuty critical alert pages the on-call engineer.
2. On-call joins the `#bedrock-incident` Slack channel and starts a Zoom bridge
   (or Teams equivalent).
3. Assign roles:
   * **Incident commander** – coordinates, keeps timeline.
   * **Communications lead** – posts updates to stakeholders.
   * **Subject-matter expert** – investigates issue (may be the on-call).

## Triage checklist

1. Collect context from alert payloads (Grafana, PagerDuty, Loki, CloudWatch).
2. Check `/healthz`, `/readyz`, `/metrics` for anomalies. Note correlation IDs.
3. Review `security:audit` logs for unusual secret access patterns.
4. Determine blast radius (single workstation, multiple hosts, CI runners).
5. Decide whether to rollback, failover, or hotfix. Document rationale.

## Communication cadence

* Post updates every 15 minutes in Slack and PagerDuty incident log.
* Use the following template:

  ```
  Status: Investigating / Mitigating / Monitoring
  Impact: <services affected, user symptoms>
  Actions: <what has been attempted>
  Next update: <timestamp>
  Owner: <name>
  ```

## Resolution & postmortem

1. Confirm recovery via `/readyz` and SLO dashboards.
2. Capture timelines (UTC) and key metrics (peak error rate, latency).
3. File a post-incident issue within 24 hours covering:
   * Root cause analysis (5 whys).
   * Corrective actions (bug fixes, documentation updates).
   * Preventive actions (tests, alert tuning).
4. Update relevant runbooks/ADRs and notify stakeholders of closure.
