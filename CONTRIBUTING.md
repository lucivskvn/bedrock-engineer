# Contributing Guidelines

Thank you for your interest in contributing to our project. Whether it's a bug report, new feature, correction, or additional
documentation, we greatly value feedback and contributions from our community.

Please read through this document before submitting any issues or pull requests to ensure we have all the necessary
information to effectively respond to your bug report or contribution.

## Reporting Bugs/Feature Requests

We welcome you to use the GitHub issue tracker to report bugs or suggest features.

When filing an issue, please check existing open, or recently closed, issues to make sure somebody else hasn't already
reported the issue. Please try to include as much information as you can. Details like these are incredibly useful:

- A reproducible test case or series of steps
- The version of our code being used
- Any modifications you've made relevant to the bug
- Anything unusual about your environment or deployment

## Contributing via Pull Requests

Contributions via pull requests are much appreciated. Before sending us a pull request, please ensure that:

1. You are working against the latest source on the _main_ branch.
2. You check existing open, and recently merged, pull requests to make sure someone else hasn't addressed the problem already.
3. You open an issue to discuss any significant work - we would hate for your time to be wasted.

To send us a pull request, please:

1. Fork the repository.
2. Modify the source; please focus on the specific change you are contributing. If you also reformat all the code, it will be hard for us to focus on your change.
3. Ensure local tests pass.
4. Commit to your fork using clear commit messages.
5. Send us a pull request, answering any default questions in the pull request interface.
6. Pay attention to any automated CI failures reported in the pull request, and stay involved in the conversation.

### Required quality checks

Before submitting a pull request, run the full verification and security suites locally:

```bash
npm run ci:verify
npm run security:audit
npm run license:check
npm run dast
```

These commands run the linter, TypeScript project checks, unit tests with coverage enabled, the dependency vulnerability audit,
the license allow-list validator, and the integration smoke tests that back the CI dynamic analysis stage. If you prefer an
isolated environment, you can execute the same workflow via Docker:

```bash
docker compose build verify
docker compose run --rm verify
```

Please include any failures you observe when filing issues so we can reproduce them quickly.

The Jest configuration enforces **≥95%** statement, branch, function, and line
coverage for the authentication token helpers, runtime configuration parser,
and health reporters under `src/main/api`. These units guard application
startup and the `/healthz` endpoint, so run `npm run ci:verify` (or
`npm test -- --coverage`) after touching them to confirm the threshold still
passes. When modifying other modules, prefer integration or smoke tests that
exercise the behaviour end-to-end.

### Dependency and license compliance

Pull requests trigger a workflow that runs the high-severity `npm audit`, the license allow-list validator (`npm run license:check`), Semgrep static analysis, integration smoke tests (`npm run dast`), and container image scanning via Trivy. The job fails when any high/critical vulnerability is detected or when a dependency exposes a non-approved license. Inspect the workflow artifacts to review audit findings, Semgrep SARIF results, and the container scan report. Nightly runs of the same workflow help keep dependencies current.

### Secrets, RBAC, and SBOM expectations

- Keep authentication tokens and cloud credentials out of source control. The server resolves API tokens from environment variables or external secret managers; prefer short-lived credentials locally and rotate them frequently.
- When configuring external secrets, set `SECRETS_DRIVER` explicitly. Use `aws-secrets-manager` (or `aws`) with GitHub OIDC-assumed IAM roles, or `hashicorp-vault` (or `vault`) with short-lived AppRole/JWT tokens. If the variable is omitted the runtime refuses to fetch secrets, emits an error, and at most logs a single suggestion based on environment signals. Explicit values keep the warning silent and document the intended secrets platform.
- Changes to the role-based access control layer (`src/main/api/auth/rbac.ts`) must retain coverage for role fallbacks and permission middleware. Extend `src/main/api/__tests__/rbac.test.ts` when introducing new permissions so that deny and allow flows remain deterministic.
- Resilience helpers guarding external service calls live in `src/main/api/resilience/index.ts`. Extend `src/main/api/__tests__/resilience.test.ts` alongside any changes to retry or circuit breaker behaviour to preserve failure-mode coverage.
- Generate a fresh SBOM with `npm run sbom:generate` before cutting a release candidate. The command writes `sbom/bom.json` (ignored in Git) and surfaces non-zero exit codes when CycloneDX encounters errors—investigate failures rather than overriding the pipeline.

### Logging and observability standards

- All `log.*` and category logger calls must emit static message strings. Use the metadata argument for request-specific fields, and rely on the `correlationId`, `traceId`, and `spanId` that the middleware injects automatically.
- API responses include an `X-Request-Id` header. Propagate upstream correlation IDs via the same header when invoking the API manually so traces, logs, and metrics can be linked across services.
- When adding new endpoints, expose liveness probes under `/healthz`, readiness probes under `/readyz`, and instrument request handling through the shared `createRequestContextMiddleware` to ensure metrics and tracing remain consistent.

GitHub provides additional document on [forking a repository](https://help.github.com/articles/fork-a-repo/) and
[creating a pull request](https://help.github.com/articles/creating-a-pull-request/).

## Finding contributions to work on

Looking at the existing issues is a great way to find something to contribute on. As our projects, by default, use the default GitHub issue labels (enhancement/bug/duplicate/help wanted/invalid/question/wontfix), looking at any 'help wanted' issues is a great place to start.

We have provided `.bedrock-engineer/agents/developer-for-bedrock-engineer.yaml`. We recommend using this agent for actual development.

## Code of Conduct

This project has adopted the [Amazon Open Source Code of Conduct](https://aws.github.io/code-of-conduct).
For more information see the [Code of Conduct FAQ](https://aws.github.io/code-of-conduct-faq) or contact
opensource-codeofconduct@amazon.com with any additional questions or comments.

## Security issue notifications

If you discover a potential security issue in this project we ask that you notify AWS/Amazon Security via our [vulnerability reporting page](http://aws.amazon.com/security/vulnerability-reporting/). Please do **not** create a public github issue.

## Licensing

See the [LICENSE](LICENSE) file for our project's licensing. We will ask you to confirm the licensing of your contribution.
