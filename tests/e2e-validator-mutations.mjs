import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import os from "node:os";

// BDD mutation suite: every mutation of the plan gate sources must be killed by a
// Given/When/Then scenario. Baseline run proves the scenarios themselves hold on the
// real build; each mutant run proves the mutated line is load-bearing.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildRoot = path.join(repoRoot, ".mutation-build");

const VALIDATOR = path.join(repoRoot, "src", "plan-validator.ts");
const EXTENSION = path.join(repoRoot, "src", "extension.ts");
const ENTRY = path.join(repoRoot, "src", "extension.ts");

// ---------------------------------------------------------------------------
// BDD scenarios
// ---------------------------------------------------------------------------

const RU_PLAN = [
  "## Context",
  "Контекст фичи на русском.",
  "## Approach",
  "1. Обновить `src/plan-validator.ts`.",
  "## Verification",
  "```sh",
  "npm test",
  "```",
  "Ожидается: всё зелёное",
].join("\n");

function planWith(lastLine) {
  return RU_PLAN.replace("Ожидается: всё зелёное", lastLine);
}

const SCENARIOS = [
  {
    id: "V-ru-expected",
    given: "a plan whose fenced command is followed by the natural Russian token",
    when: "validatePlanStructure runs",
    then: "no issues are returned",
    kind: "validator",
    input: RU_PLAN,
    assert(issues) {
      assert.deepEqual(issues, [], "natural Russian 'Ожидается:' plan must pass");
    },
  },
  {
    id: "V-ru-bullet",
    given: "the Russian token in a bullet-list continuation",
    when: "validatePlanStructure runs",
    then: "no issues are returned",
    kind: "validator",
    input: planWith("- Ожидается: всё зелёное"),
    assert(issues) {
      assert.deepEqual(issues, [], "bulleted 'Ожидается:' must pass");
    },
  },
  {
    id: "V-en-expected",
    given: "a plan with the English Expected: token",
    when: "validatePlanStructure runs",
    then: "no issues are returned",
    kind: "validator",
    input: planWith("Expected: всё зелёное"),
    assert(issues) {
      assert.deepEqual(issues, [], "'Expected:' must keep passing");
    },
  },
  {
    id: "V-compat-ojidaemo",
    given: "a plan with the v1.3.0-documented Ожидаемо: token",
    when: "validatePlanStructure runs",
    then: "no issues are returned",
    kind: "validator",
    input: planWith("Ожидаемо: всё зелёное"),
    assert(issues) {
      assert.deepEqual(issues, [], "'Ожидаемо:' must keep passing for backward compatibility");
    },
  },
  {
    id: "V-bilingual-headings",
    given: "a plan with bilingual translated headings",
    when: "validatePlanStructure runs",
    then: "every required section is missing and no verification error is raised",
    kind: "validator",
    input: [
      "## Context / Контекст",
      "Контекст.",
      "## Approach / Подход",
      "1. Обновить `src/plan-validator.ts`.",
      "## Verification / Проверка",
      "```sh",
      "npm test",
      "```",
      "Ожидается: всё зелёное",
    ].join("\n"),
    assert(issues) {
      assert.equal(issues.filter((i) => i.code === "SECTION_MISSING").length, 3);
      assert.equal(issues.filter((i) => i.code === "VERIFICATION_NOT_ACTIONABLE").length, 0);
    },
  },
  {
    id: "V-hint-exact-literal",
    given: "a plan without any required section",
    when: "validatePlanStructure runs",
    then: "the SECTION_MISSING fix names the exact English heading literal",
    kind: "validator",
    input: "# Title Only\n",
    assert(issues) {
      const missing = issues.find((i) => i.code === "SECTION_MISSING" && i.section === "Context");
      assert.ok(missing, "Context must be reported missing");
      assert.match(missing.fix, /exactly "## Context"/);
      assert.match(missing.fix, /English literal/);
    },
  },
  {
    id: "V-hint-tokens",
    given: "a plan whose verification has a fenced command but no expected-result line",
    when: "validatePlanStructure runs",
    then: "the VERIFICATION_NOT_ACTIONABLE fix names all accepted tokens",
    kind: "validator",
    input: [
      "## Context",
      "Контекст.",
      "## Approach",
      "1. Обновить `src/plan-validator.ts`.",
      "## Verification",
      "```sh",
      "npm test",
      "```",
    ].join("\n"),
    assert(issues) {
      const verif = issues.find((i) => i.code === "VERIFICATION_NOT_ACTIONABLE");
      assert.ok(verif, "verification without proof must be reported");
      assert.match(verif.fix, /`Expected:` \/ `Ожидается:` \/ `Ожидаемо:`/);
    },
  },
  {
    id: "V-immediate-expected",
    given: "a fenced command followed by a non-expected line before the Expected: token",
    when: "validatePlanStructure runs",
    then: "the verification is not actionable",
    kind: "validator",
    input: [
      "## Context",
      "Контекст.",
      "## Approach",
      "1. Обновить `src/plan-validator.ts`.",
      "## Verification",
      "```sh",
      "npm test",
      "```",
      "Проверяем тесты.",
      "Expected: всё зелёное",
    ].join("\n"),
    assert(issues) {
      assert.equal(
        issues.filter((i) => i.code === "VERIFICATION_NOT_ACTIONABLE").length, 1,
        "Expected: must immediately follow the fenced block"
      );
    },
  },
  {
    id: "V-minimal-english",
    given: "a minimal valid English plan",
    when: "validatePlanStructure runs",
    then: "no issues are returned",
    kind: "validator",
    input: [
      "## Context",
      "Some context.",
      "## Approach",
      "1. Change `src/feature.ts`.",
      "## Verification",
      "- `bun test` → exit code 0",
    ].join("\n"),
    assert(issues) {
      assert.deepEqual(issues, [], "minimal valid plan must pass");
    },
  },
  {
    id: "B-budget-counts-preflight-passed-only",
    given: "six malformed proposals rejected uncounted and four counted handoff attempts used",
    when: "further proposals arrive on the same turn",
    then: "malformed stays NON_SLUG_PAYLOAD, the 5th counted attempt trips the budget, and the latch answers in constant time",
    kind: "budget",
    async run(module, dir) {
      const localRoot = path.join(dir, "local");
      await fs.mkdir(localRoot, { recursive: true });
      const validPlan = [
        "## Context",
        "Budget scenario context.",
        "## Approach",
        "1. Change `src/feature.ts`.",
        "## Verification",
        "- `bun test` → exit code 0",
      ].join("\n");
      await fs.writeFile(path.join(localRoot, "alpha-plan.md"), validPlan, "utf8");
      const guard = module.createPlanProtectionForTest();
      const ctx = {
        sessionManager: { getSessionId: () => "bdd-mutation-budget" },
        localProtocolOptions: { getArtifactsDir: () => dir, getSessionId: () => "bdd-mutation-budget" },
        hasUI: false,
        ui: { notify() {} },
      };
      const call = (id, content) =>
        guard.handleToolCall({ toolName: "write", toolCallId: id, input: { path: "xd://propose", content } }, ctx);
      const malformed = ["# full markdown", "", " alpha", "alpha ", "../old", "a/b"];
      for (let i = 0; i < malformed.length; i++) {
        const result = await call(`m${i}`, malformed[i]);
        assert.equal(result?.block, true, `malformed case ${i} must block`);
        assert.match(result.reason, /NON_SLUG_PAYLOAD/, `malformed case ${i} must not consume the budget`);
      }
      const ghost = await call("g1", "ghost");
      assert.match(ghost.reason, /PLAN_FILE_MISSING/, "missing artifact must be a preflight rejection");
      assert.equal(await call("c1", "alpha"), undefined, "1st counted attempt must pass");
      const ghost2 = await call("g2", "ghost");
      assert.match(ghost2.reason, /PLAN_FILE_MISSING/, "artifact miss between attempts must stay uncounted");
      assert.equal(await call("c2", "alpha"), undefined, "2nd counted attempt must pass");
      assert.equal(await call("c3", "alpha"), undefined, "3rd counted attempt must pass");
      assert.equal(await call("c4", "alpha"), undefined, "4th counted attempt must pass");
      const boundary = await call("c5", "# full markdown");
      assert.match(boundary.reason, /NON_SLUG_PAYLOAD/, "malformed at the boundary must not be TURN_BLOCKED");
      const fifth = await call("c6", "alpha");
      assert.match(fifth.reason, /PLAN_VALIDATOR_TURN_BLOCKED/, "5th counted attempt must trip the budget");
      assert.match(fifth.reason, /Too many proposals without progress/);
      const latched = await call("c7", "alpha");
      assert.match(latched.reason, /budget exceeded for this user turn\. Wait for user feedback/, "latch must take the sticky constant-time path");
      assert.doesNotMatch(latched.reason, /Too many proposals/);
    },
  },
];

// ---------------------------------------------------------------------------
// Mutations: each must be killed by at least one scenario
// ---------------------------------------------------------------------------

function mustReplace(src, from, to, id) {
  const once = src.split(from).length - 1;
  assert.equal(once, 1, `mutation ${id}: anchor must occur exactly once, found ${once}`);
  return src.replace(from, to);
}

const BUDGET_BLOCK = `        turn.proposalCount += 1;
        if (turn.proposalCount > MAX_TURN_PROPOSALS) {
          turn.blocked = true;
          return {
            block: true,
            reason: "[PLAN_VALIDATOR_TURN_BLOCKED] Plan handoff budget exceeded for this user turn. Too many proposals without progress; wait for user feedback or native Refine.",
          };
        }
`;

const MUTATIONS = [
  {
    id: "M-drop-expected",
    file: VALIDATOR,
    why: "English Expected: token must stay accepted",
    from: "(?:Expected|Ожидается|Ожидаемо):",
    to: "(?:Ожидается|Ожидаемо):",
  },
  {
    id: "M-drop-ozhidaetsya",
    file: VALIDATOR,
    why: "the production bug: natural Russian Ожидается: must be accepted",
    from: "(?:Expected|Ожидается|Ожидаемо):",
    to: "(?:Expected|Ожидаемо):",
  },
  {
    id: "M-drop-ozhidaemo",
    file: VALIDATOR,
    why: "v1.3.0 backward compatibility must keep Ожидаемо:",
    from: "(?:Expected|Ожидается|Ожидаемо):",
    to: "(?:Expected|Ожидается):",
  },
  {
    id: "M-drop-bullet-prefix",
    file: VALIDATOR,
    why: "bullet/number continuation before the token must stay accepted",
    from: "/^(?:[-*]\\s+|\\d+[.)]\\s+)?(?:Expected",
    to: "/^(?:Expected",
  },
  {
    id: "M-generic-section-hint",
    file: VALIDATOR,
    why: "SECTION_MISSING hint must state the exact English heading literal",
    from: 'Add a section whose heading line is exactly "## ${req}" (English literal; translations, bilingual, or decorated headings are not matched).',
    to: 'Add "## ${req}" section to the plan.',
  },
  {
    id: "M-generic-verification-hint",
    file: VALIDATOR,
    why: "VERIFICATION_NOT_ACTIONABLE hint must name all accepted tokens",
    from: "or a fenced command followed by `Expected:` / `Ожидается:` / `Ожидаемо:` <observable result>.",
    to: "or a fenced command followed by Expected: <observable result>.",
  },
  {
    id: "M-relaxed-heading-match",
    file: VALIDATOR,
    why: "headings must stay exact English literals",
    from: "CANONICAL_SECTIONS.find((s) => s === title)",
    to: "CANONICAL_SECTIONS.find((s) => title.startsWith(s))",
  },
  {
    id: "M-late-expected-accepted",
    file: VALIDATOR,
    why: "Expected: must immediately follow the fenced block",
    from: "          // The first non-empty line after code block is NOT Expected:, so this block doesn't qualify\n          break;",
    to: "          // The first non-empty line after code block is NOT Expected:, so this block doesn't qualify",
  },
  {
    id: "M-budget-counts-malformed",
    file: EXTENSION,
    why: "the production bug: budget must count only preflight-passed proposals",
    async apply(src) {
      let out = mustReplace(src, BUDGET_BLOCK, "", "M-budget-counts-malformed(remove-after-preflight)");
      const preflightAnchor = "        // Step 1: Deterministic check (0 tokens)";
      out = mustReplace(out, preflightAnchor, BUDGET_BLOCK + preflightAnchor, "M-budget-counts-malformed(reinsert-before-preflight)");
      return out;
    },
  },
  {
    id: "M-budget-off-by-one",
    file: EXTENSION,
    why: "exactly 4 counted attempts must stay allowed",
    from: "if (turn.proposalCount > MAX_TURN_PROPOSALS) {",
    to: "if (turn.proposalCount >= MAX_TURN_PROPOSALS) {",
  },
  {
    id: "M-budget-no-latch",
    file: EXTENSION,
    why: "over-budget must latch the turn for constant-time rejection",
    from: "if (turn.proposalCount > MAX_TURN_PROPOSALS) {\n          turn.blocked = true;",
    to: "if (turn.proposalCount > MAX_TURN_PROPOSALS) {",
  },
];

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const home = os.homedir();
const ompRoot = process.env.OMP_CODING_AGENT_ROOT ?? path.join(home, ".omp", "plugins", "node_modules", "@oh-my-pi", "pi-coding-agent");
const { loadLegacyPiModule } = await import(pathToFileURL(path.join(ompRoot, "src/extensibility/plugins/legacy-pi-compat.ts")).href);

async function loadModule(bundlePath) {
  return loadLegacyPiModule(bundlePath);
}

async function runScenarios(module, kind) {
  const failures = [];
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "bdd-mut-"));
  try {
    for (const scenario of SCENARIOS) {
      if (kind && scenario.kind !== kind) continue;
      try {
        if (scenario.kind === "validator") {
          scenario.assert(module.validatePlanStructure(scenario.input));
        } else {
          await scenario.run(module, scratch);
        }
      } catch (error) {
        failures.push({ scenario: scenario.id, error: String(error && error.message || error).split("\n")[0] });
      }
    }
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }
  return failures;
}

async function buildInto(dir) {
  await fs.mkdir(dir, { recursive: true });
  const outfile = path.join(dir, "extension.js");
  const result = spawnSync("bun", [
    "build", ENTRY,
    "--outfile", outfile,
    "--target", "bun",
    "--format", "esm",
    "--external", "@oh-my-pi/pi-ai",
  ], { cwd: repoRoot, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`bun build failed: ${result.stderr || result.stdout}`);
  }
  return outfile;
}

async function main() {
  process.env.OMP_PLAN_ADVISOR = "0";
  const mutants = [];
  try {
    // Baseline: real sources must satisfy every scenario.
    const baselineBundle = await buildInto(path.join(buildRoot, "baseline"));
    const baselineModule = await loadModule(baselineBundle);
    const baselineFailures = await runScenarios(baselineModule);
    assert.deepEqual(baselineFailures, [], "baseline sources must pass every BDD scenario");

    for (const mutation of MUTATIONS) {
      const dir = path.join(buildRoot, mutation.id);
      const lf = (text) => text.replace(/\r\n/g, "\n");
      const original = lf(await fs.readFile(mutation.file, "utf8"));
      const otherOriginal = lf(await fs.readFile(mutation.file === VALIDATOR ? EXTENSION : VALIDATOR, "utf8"));
      const mutated = typeof mutation.apply === "function"
        ? await mutation.apply(original)
        : mustReplace(original, mutation.from, mutation.to, mutation.id);
      if (mutated === original) {
        mutants.push({ id: mutation.id, killed: false, error: "mutation produced identical source" });
        continue;
      }
      const scratchSrc = path.join(dir, "src");
      await fs.mkdir(scratchSrc, { recursive: true });
      await fs.writeFile(path.join(scratchSrc, path.basename(VALIDATOR)), mutation.file === VALIDATOR ? mutated : otherOriginal, "utf8");
      await fs.writeFile(path.join(scratchSrc, path.basename(EXTENSION)), mutation.file === EXTENSION ? mutated : otherOriginal, "utf8");
      const entry = path.join(scratchSrc, path.basename(EXTENSION));
      const outfile = path.join(dir, "extension.js");
      const result = spawnSync("bun", [
        "build", entry,
        "--outfile", outfile,
        "--target", "bun",
        "--format", "esm",
        "--external", "@oh-my-pi/pi-ai",
      ], { cwd: repoRoot, encoding: "utf8" });
      if (result.status !== 0) {
        throw new Error(`bun build failed for ${mutation.id}: ${result.stderr || result.stdout}`);
      }
      const module = await loadModule(outfile);
      const failures = await runScenarios(module);
      const killed = failures.length > 0;
      mutants.push({
        id: mutation.id,
        why: mutation.why,
        killed,
        killedBy: failures.map((f) => f.scenario),
        survivingFailure: killed ? undefined : undefined,
      });
    }

    const survivors = mutants.filter((m) => !m.killed);
    process.stdout.write(`${JSON.stringify({
      schema: "omp-plan-kit-bdd-mutations@1",
      decision: survivors.length === 0 ? "pass" : "fail",
      scenarios: SCENARIOS.length,
      mutants,
      survivors,
    }, null, 2)}\n`);
    assert.equal(survivors.length, 0, `every mutation must be killed by a BDD scenario; survivors: ${survivors.map((s) => s.id).join(", ")}`);
  } finally {
    await fs.rm(buildRoot, { recursive: true, force: true });
  }
}

await main();
