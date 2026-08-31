# OMP Plan Kit

[![Latest release](https://img.shields.io/github/v/release/stgmt/omp-plan-kit?label=release)](https://github.com/stgmt/omp-plan-kit/releases)
[![License](https://img.shields.io/github/license/stgmt/omp-plan-kit)](https://github.com/stgmt/omp-plan-kit/blob/main/LICENSE)

**OMP Plan Kit is the planning kit for Oh My Pi (OMP): it keeps the plan proposed, approved,
executed, and later reviewed as the same plan.**

The first released capability is a deterministic stale-plan guard for OMP plan mode. The kit
will grow into a structured, human-readable, AI-readable, and OMP Spec Kit-synchronized plan
workflow.

- **Hard safety first:** malformed `xd://propose` handoffs fail closed before OMP dispatch.
- **Optional bounded review:** a native OMP advisor explains concrete findings without approving
  or rewriting a plan.
- **Global user installation:** install through the official OMP plugin manager.
- **Roadmap-driven growth:** plan structure, readability, plan-pomogator workflow, and Spec Kit
  synchronization are documented in [`ROADMAP.md`](ROADMAP.md).
- **Manual proof:** installed-package E2E covers mutations, stale-plan controls, profiles,
  rollback, and native advisor behavior.

## Quick start

### Install the released plugin as an OMP user

```bash
omp plugin install github:stgmt/omp-plan-kit#v0.2.0
```

OMP isolates named profiles. For every existing profile on this PC, run the profile-aware
installer from a checkout:

```bash
node scripts/install-all-profiles.mjs
```

Restart OMP after installing or upgrading an extension package. Existing sessions do not rebuild
every initialized extension set in place.

### Verify installation

```bash
omp plugin list --json
omp plugin doctor --json
```

For a named profile:

```bash
omp --profile live-test plugin list --json
```

## What OMP Plan Kit prevents today

OMP's `xd://propose` device expects a plan title/slug. If a caller sends the entire Markdown plan,
OMP may fail to reconstruct the intended `local://<slug>-plan.md` and enter a discovery/state
fallback. If an older plan exists, the wrong plan can be approved.

The current kit blocks that exact failure before OMP executes the write:

1. The proposal payload must be one strict slug.
2. The exact `local://<slug>-plan.md` artifact must already exist in the session local root.
3. Missing or unsafe artifacts are rejected; another plan is never substituted.
4. The exact artifact receives a SHA-256 receipt for forensic identity.
5. The hard decision uses no model, proxy, or transcript.

## Runtime architecture

```text
OMP write(path=xd://propose, content=...)
                    │
                    ▼
          OMP Plan Kit extension
          ├─ strict slug validation
          ├─ exact session-local path
          ├─ file + SHA-256 preflight
          └─ block or pass unchanged
                    │
                    ▼
            OMP plan resolver
```

The programmer guard is the authority for allow/block. The optional advisor is explanatory only.
It cannot approve, rewrite, or unblock a rejected handoff.

## Optional native OMP advisor

The advisor runs only when a deterministic finding exists:

- malformed `xd://propose` payload;
- a todo update repeats a scope term explicitly rejected in the latest user prompt.

It uses OMP's own model runtime:

```text
ctx.models.resolve("@advisor")
ctx.modelRegistry.getApiKey(model)
complete(model, context, { maxTokens: 160, disableReasoning: true })
```

Budget and context rules:

- maximum two calls per OMP session;
- 120-second cooldown and repeated-signature suppression;
- 160 output tokens maximum, reasoning disabled;
- bounded evidence only, never the full plan or transcript;
- result is a UI notification, not a message inserted into the main model context;
- model failure never weakens the programmer guard.

Configuration:

| Variable | Default | Purpose |
|---|---:|---|
| `OMP_PLAN_ADVISOR` | `1` | Set `0` to disable only the advisor |
| `OMP_PLAN_ADVISOR_MAX_CALLS` | `2` | Per-session advisor call cap |
| `OMP_PLAN_ADVISOR_COOLDOWN_MS` | `120000` | Duplicate/cooldown window |
| `OMP_PLAN_ADVISOR_TIMEOUT_MS` | `3000` | Native OMP model-call timeout |
| `OMP_PLAN_ADVISOR_MAX_TOKENS` | `160` | Output-token cap, clamped to 32–256 |
| `OMP_PLAN_ADVISOR_MODEL` | `@advisor` | OMP model or role resolved by `ctx.models` |

## Roadmap

The product roadmap is intentionally staged:

1. handoff identity and revision receipts;
2. plan structure and completeness;
3. human and AI readability;
4. plan-pomogator workflow with durable corrections, requirements, tasks, and evidence;
5. synchronization with the project's OMP Spec Kit graph;
6. review, approval, and evidence UX;
7. distribution and ecosystem integrations.

Read the full milestones, release gates, non-goals, and Spec Kit integration contract in
[`ROADMAP.md`](ROADMAP.md).

## Manual verification

These are manual runtime probes, not a generic automated test-suite claim.

### Programmer mutations and edge cases

```bash
npm run e2e:programmer
```

The probe loads the installed release package through OMP's real loader and exercises:

- full Markdown, empty, whitespace, and traversal payloads;
- missing exact artifact;
- unrelated writes;
- valid exact slug/artifact;
- deletion of the exact artifact while an old plan remains;
- an unguarded-core control showing the stale selection;
- every existing OMP profile's installed package and loader import.

### Advisor budget and trigger behavior

```bash
npm run e2e:advisor
```

The probe verifies malformed-proposal and rejected-term triggers, duplicate suppression, bounded
request shape, disabled reasoning, and zero extra calls on the normal proposal path.

### Live native OMP model path

```bash
npm run e2e:advisor:live
```

This performs one real native OMP `complete()` call using the configured `@advisor` model and
shows the resulting UI advisory without exposing credentials.

### Rollback and reinstall

```bash
npm run uninstall-global
node scripts/install-all-profiles.mjs
```

The helpers use the official OMP user plugin lifecycle for every current profile.

## Repository map

```text
src/plan-protection.ts                 current extension implementation
dist/extension.js                      shipped OMP plugin entrypoint
ROADMAP.md                             product direction and release gates
llms.txt                               concise AI-readable project facts
scripts/install-all-profiles.mjs       official CLI link across current profiles
scripts/uninstall-all-profiles.mjs     official CLI uninstall across current profiles
scripts/e2e-programmer.mjs             manual loader, mutation, and edge probe
scripts/e2e-advisor-contract.mjs       manual advisor budget/trigger probe
scripts/e2e-advisor-live.mjs           one native OMP model-call probe
audit-reports/                         source grounding, release, and install evidence
```

## FAQ

### What is OMP Plan Kit?

It is an Oh My Pi plugin for safe, structured, and eventually spec-synchronized AI coding plans.
The current release protects plan identity; later releases add completeness, readability,
plan-pomogator workflow, and OMP Spec Kit integration.

### Does the hard guard need an LLM?

No. The hard guard uses the OMP tool event, slug grammar, exact session-local file path, file
existence, containment, and SHA-256. The advisor only explains deterministic findings.

### Does OMP Plan Kit replace OMP's resolver?

No. It runs before the resolver and blocks inputs that could activate an unsafe fallback. Valid
slug-based plan flow is passed through unchanged.

### Can it understand a todo semantically?

Not deterministically from arbitrary prose. The roadmap therefore plans a structured requirement,
plan, task, and scope contract. Until then, the advisor is advisory and the artifact identity
guard remains the hard boundary.

### Is the plugin global?

It is a user-scope plugin in each installed OMP profile. OMP profile roots are isolated, so run
the profile-aware installer after creating a new named profile.

### What happens when the advisor model is unavailable?

The advisor records a bounded failure and stays out of the way. A malformed proposal remains
blocked by the programmer guard.

### How do I report a stale-plan bug?

Do not publish credentials, private plan contents, or a full transcript. Include the OMP version,
profile, proposal payload shape, expected/selected plan identity, and redacted manual E2E output.

## Release

Current release: [`v0.2.0`](https://github.com/stgmt/omp-plan-kit/releases/tag/v0.2.0).

License: MIT.
