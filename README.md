# OMP Plan Protection

[![Latest release](https://img.shields.io/github/v/release/stgmt/omp-plan-protection?label=release)](https://github.com/stgmt/omp-plan-protection/releases)
[![License](https://img.shields.io/github/license/stgmt/omp-plan-protection)](https://github.com/stgmt/omp-plan-protection/blob/main/LICENSE)

**A standalone Oh My Pi (OMP) plugin that prevents stale-plan substitution during plan mode.**
It adds a deterministic pre-execution guard for `xd://propose` and an optional low-token
advisor for high-confidence scope mistakes.

- **No external proxy dependency.** The optional advisor uses OMP's native model API.
- **No silent rewrite.** Invalid plan handoffs are blocked, not guessed into another slug.
- **Global user installation.** Link the plugin with the official `omp plugin` CLI.
- **Manual E2E proof.** The repository includes hands-on mutation and edge-case probes against
  the installed OMP loader and plan resolver.

## Quick start

### Install in the current OMP profile

```bash
omp plugin link E:/repos/omp-plan-protection --scope user
```

### Install for every existing OMP profile on this PC

OMP keeps native user state per profile. This helper invokes the normal OMP CLI once for the
default profile and once for every named profile under `~/.omp/profiles/`:

```bash
node scripts/install-all-profiles.mjs
```

Restart OMP after installing or upgrading an extension package. Existing sessions do not
rebuild every initialized extension set in place.

### Verify the installed plugin

```bash
omp plugin list --json
omp plugin doctor --json
```

For a named profile:

```bash
omp --profile live-test plugin list --json
```

When this repository is published, the remote installation form is the default user-scope install:

```bash
omp plugin install github:stgmt/omp-plan-protection#v0.1.1
```

## What problem it prevents

In OMP plan mode, the `xd://propose` device expects a plan title/slug. If a caller sends the
entire Markdown plan instead, OMP can fail to reconstruct the intended `local://<slug>-plan.md`
file and enter its plan-file discovery fallback. With an older plan present, the wrong plan can
be approved and executed.

The plugin stops that class of failure before OMP dispatch:

1. `xd://propose` must receive one strict slug.
2. `local://<slug>-plan.md` must already exist in the current session's local root.
3. A missing exact artifact is a hard error; another plan is never substituted.
4. The exact artifact receives a SHA-256 receipt for forensic identity.
5. The guard has no model, network, proxy, or transcript dependency.

## How the plugin works

```text
OMP write tool call
        │
        ▼
plan-protection extension
  ├─ strict slug check
  ├─ exact local plan path
  ├─ regular-file + SHA-256 preflight
  └─ block or allow
        │
        ▼
OMP xd://propose resolver
```

The hard decision is deterministic. The optional advisor is a separate explanation path. It
cannot approve, rewrite, or unblock a rejected proposal.

## Optional bounded advisor

The advisor runs only when a programmer check has found something concrete:

- malformed `xd://propose` payload;
- a todo update repeating a scope term explicitly rejected in the latest user prompt.

It uses OMP's native APIs:

```text
ctx.models.resolve("@advisor")
ctx.modelRegistry.getApiKey(model)
complete(model, context, { maxTokens: 160, disableReasoning: true })
```

Budget and privacy rules:

- maximum two advisor calls per OMP session;
- 120-second cooldown and duplicate-signature suppression;
- 160 output tokens maximum, with reasoning disabled;
- bounded metadata only, never the full plan or transcript;
- result shown as a UI notification, not inserted into the main model context;
- model failure is fail-open for advice and never weakens the programmer guard.

Environment overrides:

| Variable | Default | Purpose |
|---|---:|---|
| `OMP_PLAN_ADVISOR` | `1` | Set `0` to disable only the advisor |
| `OMP_PLAN_ADVISOR_MAX_CALLS` | `2` | Per-session advisor call cap |
| `OMP_PLAN_ADVISOR_COOLDOWN_MS` | `120000` | Duplicate/cooldown window |
| `OMP_PLAN_ADVISOR_TIMEOUT_MS` | `3000` | Native model-call timeout |
| `OMP_PLAN_ADVISOR_MAX_TOKENS` | `160` | Output-token cap, clamped to 32–256 |
| `OMP_PLAN_ADVISOR_MODEL` | `@advisor` | OMP model or role resolved by `ctx.models` |

## Global profile behavior

The OMP native user extension directory is profile-scoped:

```text
~/.omp/agent/extensions/                         default profile
~/.omp/profiles/<name>/agent/extensions/         named profile
```

The package itself is installed through OMP's user plugin registry and linked into the
profile-specific plugin directory. `scripts/install-all-profiles.mjs` reconciles every profile
that exists when it runs. Rerun it after creating a new named profile.

## Manual E2E verification

These are manual runtime probes, not a claim that a generic test suite proves the feature.
They load the installed `dist/extension.js` through OMP's real host loader and exercise the real
OMP plan functions with temporary session-local files.

### Programmer guard, mutations, and edges

```bash
npm run e2e:programmer
```

Covered cases:

- full Markdown body;
- empty payload;
- surrounding whitespace;
- path traversal;
- missing exact artifact;
- unrelated ordinary write;
- valid exact slug;
- deleting the exact artifact while an old plan remains;
- control run showing the unguarded OMP resolver selecting the old plan.

### Advisor budget and trigger behavior

```bash
npm run e2e:advisor
```

Covers the malformed-proposal trigger, rejected-term todo trigger, duplicate suppression,
160-token limit, disabled reasoning, bounded prompt, and zero additional calls for a normal
proposal.

### Live native OMP model advisor

```bash
npm run e2e:advisor:live
```

This performs one real native OMP `complete()` call using the configured `@advisor` model and
reports the returned UI advisory without exposing credentials.

### Install, rollback, and reinstall

```bash
npm run uninstall-global
npm run install-global
```

The scripts use OMP's standard uninstall/link lifecycle for every current profile. Verify again
with `omp plugin list --json` and `omp plugin doctor --json`.

## Security and privacy

- No credentials are stored by the plugin.
- The hard guard reads only the current session's local plan artifact.
- Advisor receipts contain event metadata, model identity, bounded output length, and usage
  metadata; they do not store the plan or transcript body.
- The advisor never uses `claude -p`, an external proxy, or a second hidden model context.
- A malformed proposal remains blocked when the advisor is disabled or unavailable.

## Repository map

```text
src/plan-protection.ts                 OMP extension factory and runtime policy
dist/extension.js                      shipped extension entrypoint
scripts/install-all-profiles.mjs       official CLI link across current profiles
scripts/uninstall-all-profiles.mjs     official CLI uninstall across current profiles
scripts/e2e-programmer.mjs             manual OMP loader + mutation probe
scripts/e2e-advisor-contract.mjs       manual advisor contract/budget probe
scripts/e2e-advisor-live.mjs           one native OMP model-call probe
audit-reports/                         source grounding and observed evidence
```

## FAQ

### What is OMP Plan Protection?

It is an Oh My Pi plugin for plan-mode handoff safety. It prevents OMP from silently approving a
stale local plan when `xd://propose` receives malformed or incomplete plan identity data.

### Does the hard guard need an LLM?

No. The hard guard uses only the tool path, slug grammar, session-local file existence, path
containment, and SHA-256. The optional LLM advisor only explains a deterministic warning.

### Does this replace OMP's plan resolver?

No. It runs before the resolver and refuses inputs that could activate the resolver's unsafe
fallback. Valid slug-based OMP plan flow remains unchanged.

### Is it global across OMP projects?

Yes for every profile into which the plugin is installed with `--scope user`. OMP isolates named
profiles, so `scripts/install-all-profiles.mjs` must be rerun for a profile created later.

### What happens if the advisor model is unavailable?

The advisor silently records an unavailable/failed receipt. The programmer guard keeps its normal
fail-closed behavior for malformed proposals.

### Which OMP versions are supported?

The package declares OMP `>=17.3.7` and has been manually exercised through the installed OMP
loader with the local OMP runtime.

## Release and support

Release notes are in `CHANGELOG.md`. Report a reproducible handoff with the exact OMP version,
profile, proposal payload shape, selected plan path, and the output of:

The release review is `audit-reports/release-review-v0.1.1.md`; the machine-readable summary is `llms.txt`.

```bash
npm run e2e:programmer
omp plugin doctor --json
```

License: MIT.
