# OMP Plan Kit v1.7.1 release review

Date: 2026-09-06
Repository: `stgmt/omp-plan-kit`
Release: `v1.7.1`

## Release identity

| Check | Command | Result |
|---|---|---|
| Release commit | `git rev-parse HEAD` at tag | `47f57727e1ceb273d0e1c11a6f32520a7f200030` |
| Tag identity | `git rev-parse "v1.7.1^{commit}"` | `47f57727e1ceb273d0e1c11a6f32520a7f200030` |
| Remote branch at publication | `git rev-parse origin/main` | `47f57727e1ceb273d0e1c11a6f32520a7f200030` |
| Package version | `node -p "require('./package.json').version"` | `1.7.1` |
| GitHub workflow | `gh run watch 34045249927 --exit-status` | Passed; all 11 steps green in 21s |

The release tag, release commit, and `origin/main` were identical at publication.

## Scope and candidate preflight

Fix for the Plan Mode deadlock: a `PLAN_VALIDATOR_TURN_BLOCKED` latch could never be recovered in-session because only `before_agent_start` reset the turn budget, while user answers arrive as `ask` tool results. Block reasons also told the agent to wait in prose, which the Plan Mode runtime forbids (system-reminder forces `ask` or `xd://propose`).

| Check | Result |
|---|---|
| Reproducible build | Committed vs rebuilt `dist/extension.js` SHA-256 `e13cf4a2874f4e197ea678c7c5596d72eea319f982beb5e442b82db24e8597cb` both times. |
| Syntax and registered checks | `npm run check` passed. |
| Plan validator E2E | Passed; 23 validator tests. |
| Convergence E2E | Passed; 8 tests incl. `askToolResultResetsTurnBlockAndCycles`, `abortCalls: 0`. |
| Validator mutation E2E | Passed; 21 scenarios, `survivors: []`. |
| Programmer E2E | Passed against the installed plugin (no failure output). |
| Public Plan Mode hook E2E | Passed; journal, load-order, and fallback results returned `status: PASS`. |
| Hook mutation E2E | Passed; 7 mutants killed. |
| Real handoff E2E | Passed; ask-reset Phase 5b plus strict missing-core, valid-core, native-review, legacy Markdown, budget, and cleanup scenarios. |
| Release notes | `audit-reports/v1.7.1-release-notes.md` existed before workflow dispatch. |

## Published artifact integrity

| Check | Result |
|---|---|
| GitHub release | `v1.7.1`, not draft, not prerelease, target `main`. |
| Asset set | Exactly `omp-plan-kit-1.7.1.tgz`. |
| Candidate archive contents | Exactly `package/LICENSE`, `package/README.md`, `package/package.json`, and `package/dist/extension.js`. |
| Candidate archive SHA-256 | `73adaa7a9303b1e78f108f65baeacca6d850b7ceea9ec7e76f23cce8a2c438a4`. |
| Published digest | `sha256:73adaa7a9303b1e78f108f65baeacca6d850b7ceea9ec7e76f23cce8a2c438a4`. |
| Downloaded digest | Equal to the published digest. |
| GitHub attestation | `gh attestation verify .release-download/omp-plan-kit-1.7.1.tgz --repo stgmt/omp-plan-kit` passed with exit code 0. |
| Extracted bundle | Downloaded `package/dist/extension.js` was byte-equal to the candidate `dist/extension.js`; extracted package version was `1.7.1`. |
| Release body safety | Checked; no local Windows paths or `local://` references. |

## Clean-profile proof

The unique temporary profile `omp-plan-kit-171-proof` installed `github:stgmt/omp-plan-kit#v1.7.1` and was removed after verification.

- Install returned `omp-plan-kit` version `1.7.1` with `enabled: true`.
- `omp plugin doctor --json` returned `ok` for `plugins_directory`, `package_manifest`, `node_modules`, and `plugin:omp-plan-kit`.
- The installed bundle was exercised through the OMP loader: clean import with zero errors, `tool_call`/`tool_result`/`before_agent_start`/`context` handlers present (incl. the new `tool_result` reset), malformed proposal blocked with `NON_SLUG_PAYLOAD`.
- Byte-compare of installed vs committed `dist/extension.js`: equal.
- Uninstall returned success and the scratch profile directory was confirmed absent after cleanup.

## Local fleet state after release

- `~/.omp/plugins`: official `omp plugin install github:stgmt/omp-plan-kit#v1.7.1`; pin in `~/.omp/plugins/package.json` moved from `#v1.3.0` to `#v1.7.1`; `e2e-programmer.mjs` (loads the installed plugin) passes.
- 14 named test profiles with a plugin dir received byte-verified copies of `dist/extension.js`, `package.json`, `README.md`, `LICENSE` (all report v1.7.1); 4 profiles without a plugin dir skipped.

## Failure modes and rollback

| Failure mode | Safe response |
|---|---|
| `PLAN_CORE_REQUIRED` in an activated Plan Mode session | Start line 1 with the exact JSON plan-core template injected when Plan Mode started, reread the complete artifact, and propose again. |
| `PLAN_CORE_INVALID` | Repair the named JSON field before proposing again. |
| Deterministic validation failure | Keep the session in Plan Mode and apply every listed repair without switching to another local plan. |
| Turn budget exceeded | Answer via `ask` (resets the budget) or press native Refine; do not resubmit the same proposal. |
| Need to revert the distributed plugin | Install the previous known release: `omp plugin install github:stgmt/omp-plan-kit#v1.7.0`. |

## Distribution note

The release was published through the GitHub Release workflow and OMP plugin installation path. No npm publication was performed.
