# Research: how the industry validates agent plans (and what fits omp-plan-kit)

Date: 2026-09-05
Trigger: owner critique that the v1.3.1 Russian-token fix (and even the v1.4.0 positional fix) still looks like a crutch — "the world has many languages; the problem is the naive approach".
Question: what techniques do competitors and the research literature use for deterministic plan validation, and what is the architecturally sound end-state for omp-plan-kit?

## 1. Landscape map

| System | Plan representation | Deterministic validation? | Language handling |
|---|---|---|---|
| Amazon Kiro (spec mode) | Markdown specs with EARS pattern `WHEN ... THE SYSTEM SHALL ...` | Quality analysis of requirement wording (LLM-assisted, checklist), not structural parsing of free prose | EARS keywords are fixed English; not localized |
| GitHub Spec Kit | Fixed English templates (`plan.md`, `tasks.md`, `spec.md`) + constitution + checklists | "Unit tests for English": checklists + `/speckit.analyze` cross-artifact consistency; sections exist **by construction** (generation fills a template) | English section keys fixed; not localized |
| Cucumber Gherkin | DSL `.feature` files | Full deterministic parser | The only honest multilingual solution: `# language: ru` header + centrally maintained registry `gherkin-languages.json` (70+ languages, synonyms per keyword), maintained upstream by Cucumber |
| Claude Code (plan mode) | Free-form Markdown plan file | **None** — safety comes from permission gating + human approval on exit-plan-mode | Language-irrelevant (no structural checks) |
| GitHub Copilot Workspace / plan agent | Structured plan objects (specification → steps with status), editable in UI | Schema of the plan object itself; steps are data, not prose to parse | Language-irrelevant (plan is structured data) |
| Devin (Cognition) | Structured step list UI | Human approval; no published deterministic gate | Language-irrelevant |
| LLM-Modulo frameworks (Kambhampati et al., arXiv 2402.01817, 2402.08115) | Free-form LLM plan + parser + external verifier bank (e.g. PDDL VAL) | Yes — the core thesis: LLM self-verification is unreliable; hard accept/repair decisions must come from an external deterministic verifier in a generate→test→backprompt loop | Verifier operates on a formal/parsed representation, not on natural-language tokens |
| Taskmaster-style tools | LLM extracts PRD → JSON task objects | Validation on the extracted JSON | LLM extraction absorbs the language (cost: one model call, nondeterminism) |

## 2. Key findings

**F1. omp-plan-kit is architecturally aligned with the strongest research position.**
The LLM-Modulo literature (Valmeekam/Kambhampati) demonstrates that LLM self-verification collapses on planning tasks and that an external sound verifier with a bounded backprompt loop is the correct pattern — exactly our `validatePlanStructure` + repair packet + `MAX_FAILED_VALIDATIONS`. The critique to internalize: the verifier must check a **formal representation**, not natural-language tokens.

**F2. Nobody localizes section keys.**
Kiro and Spec Kit both keep fixed English keywords/section keys for machine-checked artifacts. Gherkin, which does localize, does it via an explicit `# language:` header plus a centrally curated registry — a product decision with ongoing maintenance cost (70+ language files upstream), not an inline regex alternation. Inline token guessing (our pre-1.4.0 design) has no analogue anywhere in the industry.

**F3. The industry's real alternative to post-hoc Markdown parsing is validation-by-construction.**
Spec Kit (templates), Copilot Workspace/Devin (structured plan objects), and structured-outputs APIs all avoid parsing free prose: the plan is generated into a machine-checkable shape, so "validation" reduces to schema checking. This is the technique that eliminates both language-sensitive surfaces of ours (heading literals AND result markers) at the root.

**F4. Our v1.4.0 positional rule is not a local crutch — it is the deterministic, table-free member of the "structural check" family.**
Form 1 (`` `command` → result ``) was already language-neutral; form 2 now matches it. What remains language-coupled: canonical heading literals (defensible as format keys, same choice as Kiro/Spec Kit/Gherkin-en) and English repair messages (model-facing, low priority).

## 3. Applicability to omp-plan-kit

| Technique | Fit | Verdict |
|---|---|---|
| Positional/structural rules (v1.4.0) | Already shipped; zero language surface, zero new deps | Keep as the baseline contract |
| Fixed English section keys, documented as format contract | Matches Kiro/Spec Kit practice | Keep; write the contract down in README |
| `# language:` + keyword registry (Gherkin style) | Works, but requires a maintained registry and adds a parse mode for marginal gain — positional rules already removed the need | Not recommended now; revisit only if localized heading keys become a real demand |
| **Machine-readable plan core (YAML front-matter)**: optional `---\nsections/verification/...\n---` block; validator prefers structured data, falls back to Markdown parsing | Eliminates heading-literal parsing entirely; validation-by-construction like Spec Kit/Copilot Workspace; backward compatible (front-matter optional) | **Recommended as the 1.5.x architectural step** |
| LLM extraction of plan → JSON (Taskmaster style) | Breaks the zero-cost deterministic guarantee; adds a model call inside the gate | Rejected for the deterministic tier |
| Human-approval-only (Claude Code style) | Discards the deterministic safety layer the kit exists for | Rejected |

## 4. Recommended roadmap

1. **1.4.x (done)** — positional, language-neutral verification proofs; heading literals documented as format keys.
2. **1.5.0 — machine-readable plan core**: optional YAML front-matter (`sections:`, `verification: [{command, expects}]`, `targets: [...]`). Validator: if front-matter present → schema-validate it (no prose parsing at all); else → current Markdown path. Repair packet addresses the violated field by name. Mutation suite extends with front-matter mutants.
3. **Later / optional**: `# language:` header + registry only if localized headings are actually requested by non-English users; an executable-probe tier (run the verification command, check observable result) aligned with the reality-first gate.

## 5. Effort estimate

- Front-matter core: validator +60–80 lines, schema + tests + mutation scenarios; docs. Small, no breaking changes (front-matter optional, Markdown path unchanged).

## Sources

- Kiro spec docs — requirements-first, EARS: https://kiro.dev/docs/specs/feature-specs/requirements-first/ ; https://kiro.dev/blog/deep-spec-analysis/
- GitHub Spec Kit templates and analyze flow: https://github.com/github/spec-kit/blob/main/templates/plan-template.md ; https://github.com/github/spec-kit
- Gherkin localization: https://cucumber.io/docs/gherkin/reference/ ; https://cucumber.io/docs/gherkin/languages/ ; https://github.com/cucumber/gherkin/blob/main/gherkin-languages.json
- Claude Code plan mode mechanics: https://github.com/Windy3f3f3f3f/how-claude-code-works/blob/main/en/docs/10-plan-mode.md ; https://lucumr.pocoo.org/2025/12/17/what-is-plan-mode/
- LLM-Modulo: https://arxiv.org/abs/2402.01817 ; self-verification limits: https://arxiv.org/abs/2402.08115
- Structured outputs (schema-constrained generation): https://logic.inc/resources/structured-outputs-guide
