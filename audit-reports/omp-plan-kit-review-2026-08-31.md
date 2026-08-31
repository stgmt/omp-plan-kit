# OMP Plan Kit v1.0 — review verdict

Date: 2026-08-31

## Verdict

**PASS with two documented non-blocking notes.**

The shipped v1.0 plugin is a valid OMP package, the user installation is enabled in the
remaining default profile, the deterministic guard passes the stale-plan mutation matrix, and
the bounded native advisor returns a live UI warning through OMP's own model API.

## Artifact freeze

- Repository: https://github.com/stgmt/omp-plan-kit
- Local HEAD: `9d4550d1dbde5bb458afbc17a01310bf8bb601c4`
- Release tag `v1.0.0`: `f917fc8df351524cf5e6feab7ddb4230a5bf5bce`
- v1.0 asset: `omp-plan-kit-1.0.0.tgz`
- v1.0 asset SHA-256: `e50a3377a9de4f85990bf3802da909f538cbf1399538aedcd260ca9bdd0fc195`
- Release: https://github.com/stgmt/omp-plan-kit/releases/tag/v1.0.0
- Worktree: clean before this report; report is the only review addition.

The tag and release asset are internally consistent. `main` is ahead only because a later
report-only commit added evidence and links; no runtime/package code changed after the tag.

## Package and public surface

PASS:

- `package.json` names `omp-plan-kit`, version `1.0.0`, and declares `type: module`.
- `package.json#omp.extensions` is exactly `./dist/extension.js`.
- `dist/extension.js` is present and contains the built extension factory.
- README explains the incident origin, current protection, roadmap, installation, manual E2E,
  security, and FAQ.
- `ROADMAP.md` describes the path from the current guard through lifecycle, structure,
  readability, plan-pomogator workflow, OMP Spec Kit synchronization, and review UX.
- `llms.txt` states canonical package, install, safety, roadmap, and incident facts.
- GitHub description and topics are aligned with OMP, plan mode, plan handoff, stale plans, AI
  safety, and plugin discovery.

## Runtime review

PASS:

- The hook runs at OMP `tool_call` pre-execution boundary.
- A malformed `xd://propose` payload returns a hard block before OMP dispatch.
- A missing exact artifact returns a hard block instead of selecting another plan.
- The native advisor is asynchronous explanatory feedback; it cannot change the hard decision.
- The advisor resolves `@advisor` through OMP's model registry and calls native `complete()`.
- Advisor output is bounded to 160 tokens with reasoning disabled and is displayed through UI,
  not inserted into the main model context.
- No Meridian or proxy-specific implementation is present.

Evidence paths from installed OMP:

- `C:/Users/stigm/.omp/plugins/node_modules/@oh-my-pi/pi-coding-agent/src/tools/resolve.ts:290-311`
- `C:/Users/stigm/.omp/plugins/node_modules/@oh-my-pi/pi-coding-agent/src/plan-mode/approved-plan.ts:151-188`
- `C:/Users/stigm/.omp/plugins/node_modules/@oh-my-pi/pi-coding-agent/src/extensibility/hooks/types.ts:302-314`
- `C:/Users/stigm/.omp/plugins/node_modules/@oh-my-pi/pi-coding-agent/src/extensibility/hooks/tool-wrapper.ts:42-74`
- `C:/Users/stigm/.omp/plugins/node_modules/@oh-my-pi/pi-coding-agent/src/extensibility/extensions/types.ts:443-463`
- `C:/Users/stigm/.omp/plugins/node_modules/@oh-my-pi/pi-coding-agent/src/internal-urls/local-protocol.ts:242-254`

## Manual E2E

### Programmer guard

Command:

```bash
npm run e2e:programmer
```

Result: `PASS`.

Observed mutation/edge matrix:

| Case | Result |
|---|---|
| Full Markdown instead of slug | BLOCK — `NON_SLUG_PAYLOAD` |
| Empty payload | BLOCK — `NON_SLUG_PAYLOAD` |
| Surrounding whitespace | BLOCK — `NON_SLUG_PAYLOAD` |
| Path traversal | BLOCK — `NON_SLUG_PAYLOAD` |
| Missing exact plan artifact | BLOCK — `PLAN_FILE_MISSING` |
| Ordinary non-proposal write | ALLOW |
| Exact slug and artifact | ALLOW — `local://new-plan.md` |
| Exact artifact deleted while old plan remains | BLOCK — `PLAN_FILE_MISSING` |
| Same malformed input without guard | old plan selected by OMP control |
| Current installed package loaded through OMP loader | PASS |

### Advisor

Contract command:

```bash
npm run e2e:advisor
```

Result: `PASS`.

- malformed proposal trigger: one call;
- repeated signature: deduplicated;
- rejected-term todo: second call;
- normal proposal: zero additional calls;
- prompt sizes: 373 and 328 characters;
- output cap: 160 tokens;
- reasoning: disabled.

Live command:

```bash
npm run e2e:advisor:live
```

Result: `PASS`.

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

## User installation

Final `omp plugin list --json` shows:

```text
omp-plan-kit 1.0.0 enabled=true
```

`omp plugin doctor --json` reports:

```text
plugin:omp-plan-kit — ok — v1.0.0
```

The obsolete profiles `devpom-omp-mcp-smoke` and `live-test` were removed. Their old
profile-specific symlinks were unlinked without deleting the target repositories.

## Findings

### P2 — release tag is behind current main by a report-only commit

- Tag: `f917fc8...`
- Main: `9d4550d...`
- Scope: documentation/report only; no runtime or package artifact drift.
- Decision: accepted. The v1.0 artifact remains pinned and verified.

### Informational — OMP profile isolation

OMP creates separate plugin roots for named profiles. Only the default profile remains on this
machine after cleanup. A future named profile needs an explicit user install; this is documented
in README and the profile installer.

## Next product boundary

The next meaningful feature is an immutable proposal receipt containing proposal id, plan path,
content hash, revision, and approval binding. It belongs in the roadmap's lifecycle phase and
should be implemented in OMP core or a first-class OMP proposal contract, not inferred by the
LLM advisor.
