# Security Policy

## Reporting a vulnerability

Do not publish secrets, full session transcripts, or private plan contents in a public issue.
Open a private GitHub security report when the issue could expose credentials or execute an
unexpected plan artifact.

For ordinary reproducible plan-handoff failures, redact local paths and report:

- OMP version and profile;
- proposal payload shape (not private plan content);
- expected and selected plan slugs;
- the relevant manual E2E result;
- `omp plugin doctor --json` output with local paths removed if necessary.

## Security properties

- The hard guard fails closed on malformed proposal identity and missing exact artifacts.
- Valid proposals are handed to native OMP review and watchdog logic after deterministic checks.
- This plugin does not send plan contents to a plan-specific model or persist model credentials.
- Any model credentials used by native OMP remain outside this plugin's storage.
- Receipts are local diagnostic records and must not be uploaded without review.
