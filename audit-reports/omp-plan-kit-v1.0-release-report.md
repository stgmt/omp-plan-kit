# OMP Plan Kit v1.0.0 — final release and user verification

Date: 2026-08-31

## Final state

- Repository: https://github.com/stgmt/omp-plan-kit
- Release: https://github.com/stgmt/omp-plan-kit/releases/tag/v1.0.0
- Local checkout: `E:/repos/omp-plan-kit`
- Package: `omp-plan-kit@1.0.0`
- Release tag commit: `f917fc8df351524cf5e6feab7ddb4230a5bf5bce`
- Release asset: `omp-plan-kit-1.0.0.tgz`
- Release asset SHA-256: `e50a3377a9de4f85990bf3802da909f538cbf1399538aedcd260ca9bdd0fc195`
- Release status: published, not draft, not prerelease

The release tag and remote `main` pointed to the same commit when v1.0.0 was created. The
later report-only main update does not change the shipped plugin artifact.

## Product position

v1.0 is the stable foundation of OMP Plan Kit. It intentionally ships the hard safety boundary
first and records the next product phases in `ROADMAP.md`:

1. handoff identity and revision lifecycle;
2. plan structure and completeness;
3. human and AI readability;
4. plan-pomogator workflow with durable corrections, requirements, tasks, status, done-when, and evidence;
5. synchronization with the project's OMP Spec Kit graph;
6. review, approval, and evidence UX;
7. distribution and ecosystem integrations.

The product promise is that the proposed, approved, executed, and spec-tracked plans are one
identity with evidence at every transition.

## Public repository review

PASS:

- GitHub repository renamed to `omp-plan-kit` and is public.
- Description and topics cover Oh My Pi, OMP, plan mode, plan handoff, stale plan, AI safety,
  plugin, and developer tooling.
- README explains the incident origin, current guard, native advisor, installation, roadmap,
  manual E2E, security, and FAQ.
- `llms.txt` provides concise canonical facts for AI-readable discovery.
- `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`, `LICENSE`, issue form, and PR template exist.
- README explicitly links the originating incident: https://github.com/can1357/oh-my-pi/issues/10333.

## Plugin package review

PASS:

- `package.json` declares `type: module`.
- `package.json#omp.extensions` is exactly `./dist/extension.js`.
- `dist/extension.js` is included in the release package.
- OMP `plugin install github:stgmt/omp-plan-kit#v1.0.0` returned `enabled: true`.
- `omp plugin doctor --json` returned `plugin:omp-plan-kit — ok — v1.0.0`.
- The installed extension loaded through OMP's actual `loadExtensions` path.
- The advisor uses OMP's native `complete()` API; no Meridian or proxy-specific code is required.

## User installation evidence

The previous package name was removed from all current profiles. The released v1.0.0 package was
installed from GitHub as a user in:

- default profile;
- `devpom-omp-mcp-smoke`;
- `live-test`.

Each profile reported:

```text
name: omp-plan-kit
version: 1.0.0
enabled: true
manifest.extensions: ["./dist/extension.js"]
```

The final profile startup smoke returned:

```text
OMP_PLAN_KIT_V1_USER_E2E_OK
```

## Manual programmer E2E

Command:

```bash
npm run e2e:programmer
```

Result: PASS.

The probe loaded the installed GitHub package through OMP's real loader and exercised actual
`dispatchResolutionDevice` and `resolveApprovedPlan` behavior.

| Mutation/edge | Observed result |
|---|---|
| Full Markdown body | BLOCK — `NON_SLUG_PAYLOAD` |
| Empty payload | BLOCK — `NON_SLUG_PAYLOAD` |
| Surrounding whitespace | BLOCK — `NON_SLUG_PAYLOAD` |
| Path traversal | BLOCK — `NON_SLUG_PAYLOAD` |
| Missing exact artifact | BLOCK — `PLAN_FILE_MISSING` |
| Ordinary non-proposal write | ALLOW |
| Exact slug and exact artifact | ALLOW — exact `local://new-plan.md` |
| Exact artifact deleted while old artifact remains | BLOCK — `PLAN_FILE_MISSING` |
| Same malformed input without guard | unsafe control — old plan selected |
| OMP artifact-root override | PASS |
| Installed package loader in all current profiles | PASS |

## Manual advisor E2E

Contract probe:

```bash
npm run e2e:advisor
```

Result: PASS.

- malformed proposal trigger: one bounded native call;
- repeated identical signature: deduplicated;
- rejected-term todo trigger: second bounded native call;
- normal proposal: zero additional calls;
- request budget: `maxTokens: 160`;
- reasoning: disabled;
- prompt sizes: 373 and 328 characters;
- no full plan or transcript sent.

Live native OMP probe:

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

The manual lifecycle was exercised with:

```bash
npm run uninstall-global
npm run install-global
```

The package was removed and reinstalled through OMP's official CLI for every current profile.
The final verification then installed `github:stgmt/omp-plan-kit#v1.0.0` as the user package.

## Honest limits

- OMP named profiles use isolated plugin roots. A profile created after this report requires
  the profile-aware installer to be run again.
- The deterministic guard proves plan artifact identity, not arbitrary natural-language semantic
  equivalence between every todo sentence and every plan paragraph.
- The advisor is explanatory only and cannot approve, rewrite, or unblock a hard guard decision.
