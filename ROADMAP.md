# OMP Plan Kit Roadmap

**OMP Plan Kit** is the planning layer for [Oh My Pi (OMP)](https://github.com/can1357/oh-my-pi):
it starts as a hard safety guard for plan handoffs and grows into a readable, traceable,
spec-synchronized planning kit for AI and human teams.

This roadmap is ordered by safety and user value. Each phase must preserve the previous
phase's guarantees. A later feature never weakens the deterministic handoff boundary.

## Product direction

OMP Plan Kit should make one promise:

> The plan shown, the plan approved, the plan executed, and the plan tracked against the
> project's specifications are the same plan, with evidence at every transition.

The product serves three readers:

1. **OMP runtime** — needs an unambiguous machine identity and fail-closed transitions.
2. **AI agents** — need bounded context, explicit requirements, current tasks, and actionable
   validation feedback.
3. **Human reviewers** — need a readable plan, visible scope, rationale, risks, and proof of
   what changed.

## Current baseline — v1.0 foundation

Status: released as `omp-plan-kit` v1.0.0.

- Reject a full Markdown body sent to `xd://propose`.
- Require one exact plan slug.
- Require the exact `local://<slug>-plan.md` artifact before OMP dispatch.
- Refuse missing-artifact fallback to another local plan.
- Record the exact artifact SHA-256 for forensic identity.
- Provide optional bounded native OMP advisor feedback.
- Install through the normal OMP plugin lifecycle for every existing OMP profile.

This phase addresses the concrete stale-plan substitution failure. It does not attempt to
understand arbitrary plan prose or compare natural-language intent semantically.

## Phase 1 — Handoff integrity and plan lifecycle

Target: make every plan transition explicit and recoverable.

- Add an immutable proposal receipt: `proposal_id`, session id, plan URL, content hash,
  creation time, and OMP profile.
- Bind approval to the exact proposal receipt; reject stale, missing, or ambiguous approval.
- Record plan revisions when the artifact changes after a proposal.
- Make create, refine, propose, approve, reject, resume, and execute transitions visible.
- Add deterministic stale-plan detection across resumed sessions and compaction boundaries.
- Provide a safe recovery command that points to the current plan instead of guessing.

Release gate: no plan can move from proposal to execution without an exact identity match.

## Phase 2 — Plan structure and completeness

Target: turn a Markdown plan into a predictable, inspectable document.

Status:
- **v1.2.0 delivered:** Batch structural validation (`Context`, `Approach`, `Verification` ordering, duplicate checks, empty section checks, dependent error suppression, and single-pass repair packet) and bounded repair convergence controller (`MAX_FAILED_VALIDATIONS=3`, `MAX_SAME_HASH_REPEATS=2`, `MAX_NO_PROGRESS_ATTEMPTS=2`, `MAX_TURN_PROPOSALS=4`, sticky turn latches).
- **v1.3.0 delivered:** Actionable plan contracts (`APPROACH_TARGET_MISSING` exact step targets with `/`, `\`, `#`, `::`, `name()`, `name.member`, or `Name > Child`; `VERIFICATION_NOT_ACTIONABLE` observable verification proofs via inline `<action>` → `<result>` or fenced blocks with `Expected:` / `Ожидаемо:`).
- *Future roadmap items (not in v1.3.0):* Custom sections (`Tasks`, `File Changes`), synthetic item IDs (FR/AC/T), broken-reference checking, and semantic meaning analysis remain future scope.

Roadmap items:
- Define a versioned plan schema compatible with normal Markdown.
- Require machine-readable sections for context, goal, scope, requirements, approach, files,
  verification, risks, and next steps.
- Validate section presence, ordering, duplicate headings, empty sections, dangling references,
  and contradictory scope markers.
- Track plan items with stable ids instead of position-only bullets.
- Detect requirements or user decisions that are mentioned but not represented in tasks.
- Report incomplete plans without pretending that structural validity means delivery readiness.

Release gate: a plan can be structurally checked with zero model calls and returns actionable
file/section diagnostics.

## Phase 3 — Human and AI readability

Target: make the same plan understandable to a person and usable by an agent.

### Deterministic readability

- Check heading hierarchy, paragraph size, unexplained acronyms, ambiguous pronouns, duplicate
  goals, excessive nesting, and unbounded task lists.
- Render a compact human outline and an agent execution view from the same source.
- Detect “why” gaps: decisions without rationale, tasks without done-when conditions, and risks
  without mitigations.
- Detect stale references to files, commands, requirements, and plan ids.

### Bounded AI review

- Run an LLM only after deterministic checks find a reviewable issue or at an explicit review
  checkpoint.
- Send a small evidence packet: plan section, finding, requirement/task ids, and the exact
  question; never the full transcript by default.
- Cap calls per session, output tokens, and repeated signatures.
- Show advice to the human and agent without allowing the LLM to approve, rewrite, or bypass
  the hard guard.
- Store a redacted receipt with model, budget, finding id, and result status.

Release gate: advisor absence or failure leaves deterministic validation and safety unchanged.

## Phase 4 — Plan-Pomogator workflow

Target: bring the proven development-plan discipline into OMP Plan Kit.

- Capture the user's current goal and explicit prohibitions as first-class scope decisions.
- Preserve corrections across compaction, resume, branch, and plan refinement.
- Generate a fresh plan from the current request; never copy stale file-change lists or old
  requirements without revalidation.
- Maintain a requirements-to-plan-to-task matrix.
- Require each task to have status, estimate, done-when, verification method, and evidence path.
- Add deterministic plan freshness and scope-drift gates.
- Add phase checkpoints with explicit review/approval and resumable progress.
- Support plan-only, implement, review, and recovery modes without changing plan identity.

Release gate: a user correction is durable, visible in the plan state, and cannot be silently
replaced by an older local plan.

## Phase 5 — OMP Spec Kit integration

Target: build plans synchronized with the project's `.specs` corpus.

- Discover the active project's OMP Spec Kit through its supported plugin/MCP interface.
- Read requirements, acceptance criteria, user stories, decisions, tasks, scenarios, and
  research findings through the spec-kit graph rather than guessing Markdown paths.
- Generate a traceable plan where each plan objective and task points to a spec node.
- Surface uncovered requirements, orphan tasks, stale file changes, missing scenarios, and
  implementation/spec drift before approval.
- Import the project's current architecture decisions and constraints into a bounded plan
  context.
- Keep plan ids and spec ids distinct but linked; never merge namespaces accidentally.
- Support reverse navigation: spec requirement → plan section → task → verification evidence.
- Reconcile changes after implementation and report what the plan delivered versus deferred.

Release gate: a spec-synchronized plan has no unresolved requirement links and every planned
change has a traceable verification path.

## Phase 6 — Review, approval, and evidence UX

Target: make review a product surface, not a hidden prompt convention.

- Add a plan dashboard in OMP showing scope, status, freshness, coverage, risks, and evidence.
- Provide human review actions: approve, reject with reason, request refinement, accept scope
  change, and defer explicitly.
- Provide agent-readable review packets with bounded diagnostics.
- Export a self-contained plan review report for pull requests and issue discussions.
- Show the exact approved plan hash and the runtime plan hash side by side.
- Keep a compact audit trail that survives session resume and profile changes.

Release gate: a reviewer can explain why a plan was approved and what evidence supports it
without reading the entire session transcript.

## Phase 7 — Distribution and ecosystem

Target: make OMP Plan Kit easy to find, install, upgrade, and trust.

- Publish versioned OMP plugin releases with verified `dist/extension.js` artifacts.
- Maintain `README.md`, `llms.txt`, release notes, examples, and troubleshooting together.
- Add compatibility receipts for supported OMP versions.
- Provide profile-aware install, upgrade, rollback, and doctor commands.
- Document project-level versus user-level installation and profile isolation.
- Publish integration guidance for OMP Spec Kit and other traceability tools.
- Keep public issue templates focused on reproducible payloads, selected plan identity, and
  manual evidence.

Release gate: a clean user install from a tagged GitHub release loads through OMP's official
plugin manager and passes the manual installed-package E2E.

## Non-goals

- Replacing OMP's core plan resolver in this repository.
- Inferring semantic intent from every conversational message.
- Making an LLM the authority for approval or execution.
- Uploading full transcripts or private plans to a remote service.
- Copying dev-pomogator internals without a standalone OMP contract.

## Versioning rule

- Patch release: packaging, documentation, receipts, and compatibility fixes.
- Minor release: a backward-compatible plan schema, review surface, or Spec Kit integration.
- Major release: a breaking plan protocol or approval identity change.

Every release must include a manual E2E report covering the installed package, malformed and
missing inputs, exact positive paths, stale-plan controls, profile installation, advisor budget,
and rollback.
