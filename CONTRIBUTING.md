# Contributing

## Scope

Changes must preserve the plugin's two-layer boundary:

1. The programmer guard owns the hard allow/block decision.
2. Valid proposals pass to OMP's native review and watchdog logic.

The plugin performs deterministic validation only and does not call a plan-specific language model.

## Local workflow

```bash
bun run build
npm run check
npm run install-global
npm run e2e:programmer
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
- whether the deterministic guard or native OMP handoff changed;
- mutation and edge cases manually exercised;
- install/rollback evidence when the package manifest or entrypoint changes;
- any environment-dependent probe that could not run.
