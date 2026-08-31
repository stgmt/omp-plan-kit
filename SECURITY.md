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
- The optional advisor is not an authorization mechanism.
- The advisor receives bounded metadata rather than a full plan or transcript.
- Credentials are resolved by OMP's model registry and are not persisted by this plugin.
- Receipts are local diagnostic records and must not be uploaded without review.
