# Contributing

## Scope

Changes must preserve the plugin's two-layer boundary:

1. The programmer guard owns the hard allow/block decision.
2. The optional advisor explains deterministic findings and never approves, rewrites, or unblocks.

Do not add a model dependency to the hard path. Do not send full plans or transcripts to the
advisor.

## Local workflow

```bash
bun run build
npm run check
npm run install-global
npm run e2e:programmer
npm run e2e:advisor
npm run e2e:advisor:live
```

The E2E commands are manual runtime probes against the installed OMP loader. Run them after
rebuilding `dist/extension.js`.

## Plugin contract

- Keep `package.json#omp.extensions` pointed at `./dist/extension.js`.
- Keep the built entrypoint self-contained except for OMP host packages resolved by OMP's loader.
- Preserve profile-aware installation behavior.
- Update `README.md`, `llms.txt`, and `CHANGELOG.md` when public behavior changes.
- Add the exact observed result to the audit report for release-affecting changes.

## Pull requests

A pull request should state:

- the affected OMP event/tool path;
- whether the hard guard or advisory layer changed;
- mutation and edge cases manually exercised;
- install/rollback evidence when the package manifest or entrypoint changes;
- any environment-dependent probe that could not run.
