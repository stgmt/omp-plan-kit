# OMP Plan Kit v1.7.0 release review

Date: 2026-09-06
Repository: `stgmt/omp-plan-kit`
Release: `v1.7.0`

## Release identity

| Check | Command | Result |
|---|---|---|
| Release commit | `git rev-parse HEAD` in the isolated candidate | `2bf7697461981d190320c641f194760511eecd4d` |
| Tag identity | `git rev-parse 'v1.7.0^{commit}'` | `2bf7697461981d190320c641f194760511eecd4d` |
| Remote branch at publication | `git rev-parse origin/main` | `2bf7697461981d190320c641f194760511eecd4d` |
| Package version | `node -p "require('./package.json').version"` | `1.7.0` |
| GitHub workflow | `gh run watch 34010760030 --exit-status` | Passed; release job completed successfully |

The release tag, release commit, and `origin/main` were identical at publication. The final review report was added in a follow-up documentation commit so the published tag remains bound to the verified release commit.

## Scope and candidate preflight

The source worktree contained unrelated modified and untracked files. The release was assembled in a separate worktree from `origin/main`; only the 19 intended release files and this report were staged. The unrelated worktree files were not staged, committed, pushed, or deleted.

| Check | Result |
|---|---|
| Reproducible build | Two `npm run build` executions produced `dist/extension.js` SHA-256 `474ae4c810e7dfae82d6397c00736bea523b2f814f0e873f66239182beb112a4` both times. |
| Candidate dist status | `git diff --exit-code -- dist/extension.js` passed after the reproducibility builds. |
| Syntax and registered checks | `npm run check` passed. |
| Plan validator E2E | Passed; 23 validator tests. |
| Convergence E2E | Passed; 7 tests, `abortCalls: 0`, `notifyCalls: 2`. |
| Validator mutation E2E | Passed; 21 scenarios, `survivors: []`. |
| Programmer E2E | `bun tests/e2e-programmer.mjs` passed with no failure output. |
| Public Plan Mode hook E2E | Passed; journal, load-order, and fallback results returned `status: PASS`. |
| Hook mutation E2E | Passed; 7 mutants killed with non-zero broker calls. |
| Real handoff E2E | Passed; strict missing-core, valid-core, native-review, legacy Markdown, budget, and cleanup scenarios all returned `true`. |
| Release notes | `audit-reports/v1.7.0-release-notes.md` existed before workflow dispatch. |

The release removes the plugin-owned plan-specific LLM advisor while retaining deterministic validation, the public `omp-plan-kit:enter-plan-mode` hook, exact `PLAN_CORE_TEMPLATE` injection, session-scoped strict requirements, native OMP review, and native watchdog behavior.

## Published artifact integrity

| Check | Result |
|---|---|
| GitHub release | `v1.7.0`, not draft, not prerelease, target `main`. |
| Asset set | Exactly `omp-plan-kit-1.7.0.tgz`. |
| Candidate archive contents | Exactly `package/LICENSE`, `package/README.md`, `package/package.json`, and `package/dist/extension.js`. |
| Candidate archive SHA-256 | `41f43b1c62d45588a50551772c385614cab0a2f66f5fd2d59030a778db428f9f`. |
| Published digest | `sha256:41f43b1c62d45588a50551772c385614cab0a2f66f5fd2d59030a778db428f9f`. |
| Downloaded digest | Equal to the published digest. |
| GitHub attestation | `gh attestation verify .release-download/omp-plan-kit-1.7.0.tgz --repo stgmt/omp-plan-kit` passed with exit code 0. |
| Extracted bundle | Downloaded `package/dist/extension.js` was byte-equal to the candidate `dist/extension.js`; extracted package version was `1.7.0`. |
| Release body safety | Checked; no local Windows paths, `local://` references, or `.omp` paths. |

## Clean-profile proof

The unique temporary profile `omp-plan-kit-release-proof-20260906` installed `github:stgmt/omp-plan-kit#v1.7.0` and was removed after verification.

- Install returned `omp-plan-kit` version `1.7.0` with `enabled: true`.
- `omp plugin list --json` returned the installed package and no marketplace duplicate.
- `omp plugin doctor --json` returned `ok` for `plugins_directory`, `package_manifest`, `node_modules`, and `plugin:omp-plan-kit`.
- The installed bundle was exercised through the OMP loader with `bun tests/e2e-real-plan-handoff.mjs`; all 9 real handoff scenarios passed.
- Uninstall returned `{"uninstalled":"omp-plan-kit"}` and a subsequent plugin list was empty.
- The scratch profile, downloaded archive, and extraction directory were confirmed absent after cleanup.

## Failure modes and rollback

| Failure mode | Safe response |
|---|---|
| `PLAN_CORE_REQUIRED` in an activated Plan Mode session | Start line 1 with the exact JSON plan-core template injected when Plan Mode started, reread the complete artifact, and propose again. |
| `PLAN_CORE_INVALID` | Repair the named JSON field before proposing again. |
| Deterministic validation failure | Keep the session in Plan Mode and apply every listed repair without switching to another local plan. |
| Need to revert the distributed plugin | Install the previous known release: `omp plugin install github:stgmt/omp-plan-kit#v1.6.0`. |

## Distribution note

The release was published through the GitHub Release workflow and OMP plugin installation path. No npm publication was performed.
