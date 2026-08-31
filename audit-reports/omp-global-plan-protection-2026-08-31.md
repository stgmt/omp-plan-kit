# OMP Plan Protection — manual plugin and E2E report

Date: 2026-08-31

## Result

Standalone repository:

```text
E:/repos/omp-plan-protection
```

The repository is a normal OMP plugin package. The protection is installed through OMP's
own `plugin link` lifecycle into every currently existing OMP profile. No external proxy dependency
is present or used.

## OMP source-grounded contracts

| Claim | Status | Evidence |
|---|---|---|
| An OMP plugin exports a default extension factory | VERIFIED | `E:/repos/oh-my-pi-omp18/docs/extensions.md:19-27` |
| Plugin extension entries come from `package.json#omp.extensions` | VERIFIED | `E:/repos/oh-my-pi-omp18/docs/extension-loading.md:51-57` |
| A local path is handled by normal `omp plugin link` | VERIFIED | `E:/repos/oh-my-pi-omp18/docs/plugin-manager-installer-plumbing.md:9-14,148-162` |
| Plugin link requires package name and manifest, then records enabled runtime state | VERIFIED | `.../docs/plugin-manager-installer-plumbing.md:148-160` |
| Installed extension entries are imported and initialized during validation | VERIFIED | `.../docs/plugin-manager-installer-plumbing.md:100-113` |
| `tool_call` runs before execution and can block with `{block, reason}` | VERIFIED | installed OMP `src/extensibility/hooks/types.ts:302-314`; `src/extensibility/shared-events.ts:306-331` |
| Hook errors/blocks fail closed | VERIFIED | installed OMP `src/extensibility/hooks/tool-wrapper.ts:42-74` |
| OMP native user roots are profile-scoped | VERIFIED | installed OMP `src/discovery/builtin.ts:58-69`; `src/utils/dirs.ts:113-127,452-497` |
| Native OMP model calls are available to extensions through `complete`, model registry, and API-key lookup | VERIFIED | OMP example `packages/coding-agent/examples/hooks/custom-compaction.ts:15-18,33-38,85-90`; `examples/hooks/handoff.ts:81-99` |
| Reasoning can be explicitly disabled and output capped | VERIFIED | installed OMP `@oh-my-pi/pi-ai/src/types.ts:56-61`; plugin runtime uses `disableReasoning: true`, `maxTokens: 160` |

## Package shape

`package.json` declares:

```json
{
  "name": "omp-plan-protection",
  "version": "0.1.0",
  "type": "module",
  "files": ["package.json", "README.md", "LICENSE", "dist/"],
  "engines": { "omp": ">=17.3.7" },
  "omp": { "extensions": ["./dist/extension.js"] }
}
```

`dist/extension.js` is built and contains the runtime entrypoint. The installed plugin has no
runtime dependency on this repository's source files.

## Installation evidence

Command:

```bash
node scripts/install-all-profiles.mjs
```

This invokes the normal OMP CLI operation, not a manual extension copy:

```text
omp plugin link E:/repos/omp-plan-protection --scope user --json
omp --profile <name> plugin link E:/repos/omp-plan-protection --scope user --json
```

Passes for:

- default;
- `devpom-omp-mcp-smoke`;
- `live-test`.

`omp plugin doctor --json` reports:

```text
plugin:omp-plan-protection — ok — v0.1.0 - Global deterministic OMP plan-handoff protection with bounded advisory feedback.
```

The doctor also reports three pre-existing orphan warnings for unrelated plugin probe names;
none belongs to `omp-plan-protection`.

Startup smoke for all three profiles:

```text
PLUGIN_STARTUP_OK
```

## Programmer-only protection

`src/plan-protection.ts` uses only filesystem, path, SHA-256, and OMP extension APIs.

Hard rules:

1. `xd://propose` input must be one exact slug.
2. Full Markdown, empty input, path traversal, and surrounding whitespace are rejected.
3. `local://<slug>-plan.md` must exist as a regular file before OMP dispatch.
4. Missing exact artifacts are blocked; OMP's fallback scan cannot select another plan.
5. The guard never rewrites an invalid body into a guessed slug.
6. The guard does not depend on a model, proxy, or network.

This prevents the demonstrated substitution class. It does not pretend that a deterministic
parser can prove semantic equivalence of arbitrary natural-language todo prose.

## Bounded native LLM advisor

The optional advisor is in the same OMP extension, but is not part of the safety decision.
It uses the host OMP model selected through:

```text
ctx.models.resolve("@advisor")
ctx.modelRegistry.getApiKey(model)
complete(model, ..., { maxTokens: 160, disableReasoning: true })
```

It sends no full plan or transcript. It triggers only for:

- a programmer-detected malformed proposal;
- a todo containing a term explicitly rejected in the latest user prompt.

It deduplicates signatures, allows at most two calls per session, applies a 120-second
cooldown, and shows the answer via `ctx.ui.notify` instead of `pi.sendMessage`. Therefore the
advice does not add another message to the main model context and cannot unblock a hard block.

## Manual mutation and edge E2E

Command:

```bash
npm run e2e:programmer
```

The script uses OMP's actual `loadExtensions` loader, the installed plugin `dist/extension.js`,
actual `dispatchResolutionDevice`, and actual `resolveApprovedPlan`. It creates real temporary
session-local artifacts.

Result: `decision: pass`.

| Mutation / edge | Result |
|---|---|
| Full Markdown body | BLOCK — `NON_SLUG_PAYLOAD` |
| Empty payload | BLOCK — `NON_SLUG_PAYLOAD` |
| Surrounding whitespace | BLOCK — `NON_SLUG_PAYLOAD` |
| Path traversal | BLOCK — `NON_SLUG_PAYLOAD` |
| Valid slug with missing artifact | BLOCK — `PLAN_FILE_MISSING` |
| Unrelated ordinary write | ALLOW |
| Valid exact slug + artifact | ALLOW; OMP selected `local://new-plan.md` |
| Exact artifact deleted while old plan remains | BLOCK — `PLAN_FILE_MISSING` |
| Same malformed input without guard | OMP selected `local://old-plan.md` |

This is the direct proof that the guard stops the exact stale-plan behavior rather than merely
checking output after the fact.

## Manual advisor E2E

Contract/mutation command:

```bash
npm run e2e:advisor
```

Result: `decision: pass`.

```json
{
  "triggers": ["invalid proposal", "explicit rejected-term todo"],
  "deduplicatedRepeat": true,
  "requestShapes": [
    { "maxTokens": 160, "disableReasoning": true, "promptChars": 373 },
    { "maxTokens": 160, "disableReasoning": true, "promptChars": 328 }
  ],
  "normalProposal": { "guard": "allow", "additionalAdvisorCalls": 0 }
}
```

Live native OMP model command:

```bash
npm run e2e:advisor:live
```

Result: `decision: pass`.

```json
{
  "model": { "provider": "openai-codex", "id": "gpt-5.6-sol" },
  "hardGuard": "[PLAN_HANDOFF_NON_SLUG_PAYLOAD] ...",
  "advisory": {
    "notifications": 1,
    "outputChars": 235,
    "level": "warning",
    "maxTokens": 160,
    "reasoning": "disabled"
  },
  "loader": "OMP loadExtensions"
}
```

This is a real native OMP model call through the extension's `complete()` path. No external proxy
endpoint is involved.

## Rollback/reinstall E2E

Rollback:

```bash
npm run uninstall-global
```

Observed: OMP returned `{"uninstalled":"omp-plan-protection"}` for all three profiles, and
`omp plugin list --json` showed no `omp-plan-protection` entry.

Reinstall:

```bash
npm run install-global
```

Observed: all three profiles returned `name: omp-plan-protection`, `version: 0.1.0`,
`enabled: true`. The subsequent doctor and programmer E2E passed.

## Upstream relationship

The upstream OMP stale-plan issue is tracked at:

https://github.com/can1357/oh-my-pi/issues/10333

The plugin is the local containment mechanism. The upstream core fix should still make the
proposal/approval identity immutable and remove silent substitution when the supplied plan
identity is invalid.

## Honest limits

- Current profiles are covered by normal OMP CLI links.
- OMP profile discovery is isolated; a newly created named profile requires rerunning
  `scripts/install-all-profiles.mjs`.
- Programmer guard and advisor contract are green.
- Live native advisor E2E is green.
- Semantic natural-language equivalence between a todo and a plan is not claimed; a future
  structured scope manifest/proposal id would be required for that stronger contract.
