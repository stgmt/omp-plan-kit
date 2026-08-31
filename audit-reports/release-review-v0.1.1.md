# Release review: OMP Plan Protection v0.1.1

Date: 2026-08-31

## Reviewed candidate

- Repository: https://github.com/stgmt/omp-plan-protection
- Release: https://github.com/stgmt/omp-plan-protection/releases/tag/v0.1.1
- Release tag commit: `80d1fcd54d7fc85f4e7939c3c1b38d765bfc212b`
- Remote `main`: `80d1fcd54d7fc85f4e7939c3c1b38d765bfc212b`
- Release asset: `omp-plan-protection-0.1.1.tgz`
- Asset SHA-256: `20e56710a17aa4523d6a6c5486677237b64e14be0e7beb7ff8133cbb692e1a53`
- Release state: published, not draft, not prerelease

## Public discoverability review

PASS:

- GitHub repository is public.
- Description names Oh My Pi, OMP, plan handoff, deterministic stale-plan guard, and native advisor.
- Topics include `oh-my-pi`, `omp`, `ai-coding-agent`, `plan-mode`, `plan-handoff`, `stale-plan`, `ai-safety`, `developer-tools`, `plugin`, and `typescript`.
- README starts with the problem, install command, safety boundary, manual proof, and FAQ.
- `llms.txt` contains canonical install, behavior, safety, and evidence facts without marketing claims.
- README, package metadata, changelog, release notes, and package name all agree on `omp-plan-protection` and version `0.1.1`.
- CONTRIBUTING, SECURITY, LICENSE, issue form, and pull request template are present.

## OMP package review

PASS:

- `package.json#omp.extensions` is exactly `./dist/extension.js`.
- `dist/extension.js` exists and is the shipped runtime entrypoint.
- OMP `plugin link` accepted the package and returned `enabled: true`.
- `omp plugin doctor --json` returned `plugin:omp-plan-protection — ok — v0.1.1`.
- The installed extension was loaded through OMP's real `loadExtensions` loader; no direct-import shortcut was used for the programmer E2E.
- The native advisor uses host OMP `complete`, model resolution, and registry credentials. No external proxy dependency exists.

## User installation

The local link was removed first. The released tag was then installed with the normal user CLI path:

```text
omp plugin install github:stgmt/omp-plan-protection#v0.1.1 --json
omp --profile devpom-omp-mcp-smoke plugin install github:stgmt/omp-plan-protection#v0.1.1 --json
omp --profile live-test plugin install github:stgmt/omp-plan-protection#v0.1.1 --json
```

All three returned:

```text
name: omp-plan-protection
version: 0.1.1
enabled: true
manifest.extensions: ["./dist/extension.js"]
```

## Manual programmer E2E

Command:

```bash
npm run e2e:programmer
```

The test loads each installed profile package through OMP's `loadExtensions`, then exercises the default installed package against actual OMP `dispatchResolutionDevice` and `resolveApprovedPlan` code.

Result: PASS.

| Mutation/edge | Expected | Observed |
|---|---|---|
| Full Markdown body | block | `NON_SLUG_PAYLOAD` |
| Empty payload | block | `NON_SLUG_PAYLOAD` |
| Surrounding whitespace | block | `NON_SLUG_PAYLOAD` |
| Path traversal | block | `NON_SLUG_PAYLOAD` |
| Missing exact artifact | block | `PLAN_FILE_MISSING` |
| Ordinary non-proposal write | allow | allow |
| Exact slug and artifact | allow | `local://new-plan.md` |
| Exact artifact deleted while old plan remains | block | `PLAN_FILE_MISSING` |
| Same malformed input without guard | unsafe control | `local://old-plan.md` |

The E2E also passed the OMP artifact-root override through `ctx.localProtocolOptions`.

## Manual advisor E2E

Contract command:

```bash
npm run e2e:advisor
```

Result: PASS.

- malformed proposal trigger: one call;
- repeated identical signature: deduplicated;
- explicit rejected-term todo: second call;
- valid proposal: zero additional calls;
- `maxTokens: 160`;
- `disableReasoning: true`;
- bounded prompts: 373 and 328 characters;
- fake transport only for contract shape, no provider spend.

Live command:

```bash
npm run e2e:advisor:live
```

Result: PASS.

```json
{
  "model": { "provider": "openai-codex", "id": "gpt-5.6-sol" },
  "notifications": 1,
  "outputChars": 132,
  "maxTokens": 160,
  "reasoning": "disabled",
  "loader": "OMP loadExtensions"
}
```

The live run used the installed release package and OMP's native model API. No external proxy-specific implementation was involved.

## Rollback/reinstall

Command:

```bash
npm run uninstall-global
npm run install-global
```

The first command removed the package from all three profiles. The second reinstalled it through the official OMP CLI. A subsequent tag-based user install replaced the local link, and the programmer, advisor contract, and live advisor E2Es passed again.

## Review findings

No release-blocking finding.

One platform constraint remains explicit rather than hidden: OMP named profiles have isolated user plugin roots. The helper covers all profiles present at install time; a profile created later needs the same official install command or a rerun of `scripts/install-all-profiles.mjs`.

## Scope boundary

The deterministic guard prevents plan identity substitution. It does not claim to decide arbitrary natural-language semantic equivalence between a todo and a plan. The optional advisor is explanatory only and cannot override the hard guard.
