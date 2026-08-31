# OMP Plan Kit v0.2.1 — rename, release, and user-install review

Date: 2026-08-31

## User-visible result

The project is now named **OMP Plan Kit**, not OMP Plan Protection. The local checkout,
package name, GitHub repository, plugin id, release asset, installation commands, README,
AI-readable summary, and roadmap use the kit name.

## Repository and release

- Repository: https://github.com/stgmt/omp-plan-kit
- Release: https://github.com/stgmt/omp-plan-kit/releases/tag/v0.2.1
- Release status: published, not draft, not prerelease
- Tag commit: `7fa8e3a6c97cf3f18462d19d67a912288b848005`
- Remote `main`: `7fa8e3a6c97cf3f18462d19d67a912288b848005`
- Asset: `omp-plan-kit-0.2.1.tgz`
- Asset SHA-256: `daa08d793cd9514fd630a28da1e43e925689e6d3be3e5f11165f54655b2485a8`

The release asset digest returned by GitHub matches the locally computed digest.

## Public discoverability review

PASS:

- Public GitHub description contains Oh My Pi, OMP, plan handoff, deterministic guard, and native advisor terms.
- Topics contain `oh-my-pi`, `omp`, `omp-plan-kit`, `plan-kit`, `plan-mode`, `plan-handoff`, `stale-plan`, `ai-safety`, `developer-tools`, `plugin`, and `typescript`.
- README starts with the user problem and installation command.
- README has a roadmap link, architecture explanation, security/privacy section, manual verification commands, and FAQ answers for human and AI readers.
- `llms.txt` contains concise canonical facts and the OMP Plan Kit future direction.
- `CHANGELOG.md` records the rename and the guarded foundation.
- `CONTRIBUTING.md`, `SECURITY.md`, `LICENSE`, GitHub issue form, and pull request template are present.
- No proxy-specific dependency is part of the plugin package.

## Product roadmap

`ROADMAP.md` defines the staged product direction:

1. current deterministic handoff guard;
2. immutable proposal/revision receipts and plan lifecycle;
3. plan structure and completeness;
4. human and AI readability;
5. plan-pomogator workflow with durable corrections, requirements, tasks, status, done-when, and evidence;
6. synchronization with the project's OMP Spec Kit graph;
7. review, approval, evidence UX, and ecosystem distribution.

Each phase has a release gate. Later phases cannot weaken exact plan identity.

## OMP plugin packaging review

PASS:

- `package.json` has `type: module`.
- `package.json#omp.extensions` is exactly `./dist/extension.js`.
- `dist/extension.js` is built and included in the package.
- OMP `plugin link` accepted the package.
- OMP `plugin install github:stgmt/omp-plan-kit#v0.2.1` accepted the published tag.
- `omp plugin doctor --json` reports `plugin:omp-plan-kit — ok — v0.2.1`.
- OMP's real `loadExtensions` loader imported the installed extension for every current profile.

## User installation

The old `omp-plan-protection` package was removed from all current profiles. The released
`omp-plan-kit#v0.2.1` package was then installed with the official OMP CLI:

```text
omp plugin install github:stgmt/omp-plan-kit#v0.2.1
omp --profile devpom-omp-mcp-smoke plugin install github:stgmt/omp-plan-kit#v0.2.1
omp --profile live-test plugin install github:stgmt/omp-plan-kit#v0.2.1
```

All three profiles returned:

```text
name: omp-plan-kit
version: 0.2.1
enabled: true
manifest.extensions: ["./dist/extension.js"]
```

The old package id is absent from the final user installation.

## Manual programmer E2E

Command:

```bash
npm run e2e:programmer
```

Result: PASS.

The probe loaded the installed release package through OMP's real loader and exercised the
real `dispatchResolutionDevice` and `resolveApprovedPlan` functions.

| Mutation or edge | Observed result |
|---|---|
| Full Markdown body | BLOCK — `NON_SLUG_PAYLOAD` |
| Empty payload | BLOCK — `NON_SLUG_PAYLOAD` |
| Surrounding whitespace | BLOCK — `NON_SLUG_PAYLOAD` |
| Path traversal | BLOCK — `NON_SLUG_PAYLOAD` |
| Missing exact artifact | BLOCK — `PLAN_FILE_MISSING` |
| Ordinary non-proposal write | ALLOW |
| Exact slug + exact artifact | ALLOW — `local://new-plan.md` |
| Exact artifact deleted while old artifact remains | BLOCK — `PLAN_FILE_MISSING` |
| Same malformed input without guard | unsafe control — `local://old-plan.md` |
| OMP session artifact-root override | PASS |
| Extension import in each current profile | PASS |

## Manual advisor E2E

Contract command:

```bash
npm run e2e:advisor
```

Result: PASS.

- malformed proposal trigger: one bounded native call;
- repeated identical signature: deduplicated;
- explicitly rejected-term todo: second bounded native call;
- normal proposal: zero additional calls;
- `maxTokens: 160`;
- `disableReasoning: true`;
- prompts: 373 and 328 characters;
- no full plan or transcript sent.

Live native OMP model command:

```bash
npm run e2e:advisor:live
```

Result: PASS.

```json
{
  "model": { "provider": "openai-codex", "id": "gpt-5.6-sol" },
  "notifications": 1,
  "level": "warning",
  "maxTokens": 160,
  "reasoning": "disabled",
  "loader": "OMP loadExtensions"
}
```

## Rollback and reinstall

The uninstall/reinstall cycle was exercised manually before the final tag installation:

```bash
npm run uninstall-global
npm run install-global
```

It removed and reinstalled the package through the official OMP CLI for all existing profiles.
The final clean migration then removed the old package id and installed the GitHub release tag.

## Review findings

No release-blocking findings.

One OMP platform constraint remains explicit: named profiles have isolated plugin roots. The
profile installer covers every profile existing at invocation time. If a new named profile is
created later, rerun:

```bash
node scripts/install-all-profiles.mjs
```

## OMP evidence paths

- `C:/Users/stigm/.omp/plugins/node_modules/@oh-my-pi/pi-coding-agent/src/tools/resolve.ts:290-311` — proposal title-only dispatch.
- `C:/Users/stigm/.omp/plugins/node_modules/@oh-my-pi/pi-coding-agent/src/plan-mode/approved-plan.ts:151-188` — approval fallback.
- `C:/Users/stigm/.omp/plugins/node_modules/@oh-my-pi/pi-coding-agent/src/extensibility/hooks/types.ts:302-314` — pre-execution block contract.
- `C:/Users/stigm/.omp/plugins/node_modules/@oh-my-pi/pi-coding-agent/src/extensibility/hooks/tool-wrapper.ts:42-74` — fail-closed execution wrapper.
- `C:/Users/stigm/.omp/plugins/node_modules/@oh-my-pi/pi-coding-agent/src/discovery/builtin.ts:58-69` — profile-scoped user discovery.
- `E:/repos/oh-my-pi-omp18/docs/extension-loading.md:51-57` — packaged `omp.extensions` loading.
- `E:/repos/oh-my-pi-omp18/docs/plugin-manager-installer-plumbing.md:100-113,148-162` — install/link and validation lifecycle.
