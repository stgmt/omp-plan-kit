import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionSourcePath = path.join(repoRoot, "src", "extension.ts");
const hookSourcePath = path.join(repoRoot, "src", "plan-mode-hook.ts");
const validatorSourcePath = path.join(repoRoot, "src", "plan-validator.ts");
const requirementSourcePath = path.join(repoRoot, "src", "plan-core-requirement.ts");
const home = os.homedir();
const ompNodeModules = path.join(home, ".omp", "plugins", "node_modules");
const nodePaths = (process.env.NODE_PATH ?? "").split(path.delimiter).filter(Boolean);
if (!nodePaths.includes(ompNodeModules)) {
  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_PATH: [...nodePaths, ompNodeModules].join(path.delimiter) },
    stdio: "inherit",
  });
  if (child.error) throw child.error;
  process.exit(child.status ?? 1);
}
const ompRoot = process.env.OMP_CODING_AGENT_ROOT
  ?? path.join(ompNodeModules, "@oh-my-pi", "pi-coding-agent");
const { loadExtensions } = await import(
  pathToFileURL(path.join(ompRoot, "src/extensibility/extensions/loader.ts")).href
);
const { loadLegacyPiModule } = await import(
  pathToFileURL(path.join(ompRoot, "src/extensibility/plugins/legacy-pi-compat.ts")).href
);

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omp-plan-mode-hook-mut-"));
const probeKey = Symbol.for("omp-plan-kit:test:broker-calls");
const consumerKey = Symbol.for("omp-plan-kit:test:mutation-consumer");
const mutations = [
  {
    id: "M-plan-context-type",
    target: "hook",
    why: "only the exact native plan-mode customType may trigger entry",
    from: `function isPlanModeContextMessage(message: unknown): boolean {
  return isRecord(message)
    && message.role === "custom"
    && message.customType === PLAN_MODE_CONTEXT_TYPE;
}`,
    to: `function isPlanModeContextMessage(message: unknown): boolean {
  return isRecord(message)
    && message.role === "custom";
}`,
    expectedFailure: /exact customType detection/,
  },
  {
    id: "M-shared-event-bus",
    target: "hook",
    why: "the broker must publish through ExtensionAPI.events",
    from: "      this.#events.emit(ENTER_PLAN_MODE_CHANNEL, event);",
    to: "      void event;",
    expectedFailure: /shared event bus/,
  },
  {
    id: "M-repeat-entry",
    target: "hook",
    why: "one activation must publish one enter event",
    from: "    let activation = state.active;",
    to: "    let activation = undefined;",
    expectedFailure: /one enter event per activation/,
  },
  {
    id: "M-duplicate-injection",
    target: "hook",
    why: "reapplying context must replace prior ephemeral instructions",
    from: `    const messagesWithoutPriorInstructions = event.messages.filter(
      (message) => !isPlanModeInstructionMessage(message),
    );`,
    to: "    const messagesWithoutPriorInstructions = event.messages;",
    expectedFailure: /one instruction per ID/,
  },
  {
    id: "M-template-replacement",
    target: "extension",
    why: "the built-in instruction must carry the exported plan-core template exactly",
    from: `  PLAN_CORE_TEMPLATE,
  "Replace every placeholder value, but keep all JSON key names unchanged. Values may use any language.",`,
    to: `  "---\\n{\\"mutated\\": true}\\n---",
  "Replace every placeholder value, but keep all JSON key names unchanged. Values may use any language.",`,
    expectedFailure: /exact exported plan-core template/,
  },
  {
    id: "M-skip-requirement-activation",
    target: "extension",
    why: "plan entry must activate strict validation for that session",
    from: "    requirements.activate(raw.sessionId, raw.activationId);",
    to: "    void raw.activationId;",
    expectedFailure: /activated session must require machine-readable plan core/,
  },
  {
    id: "M-requirement-always-false",
    target: "requirement",
    why: "the registry must report activated sessions as strict",
    from: "    return this.#activationIds.has(sessionId);",
    to: "    return false;",
    expectedFailure: /activated session must require machine-readable plan core/,
  },
];

function replaceExactlyOnce(source, from, to, label) {
  const first = source.indexOf(from);
  assert.ok(first >= 0, `${label}: mutation anchor missing`);
  assert.equal(source.indexOf(from, first + from.length), -1, `${label}: mutation anchor is ambiguous`);
  return source.slice(0, first) + to + source.slice(first + from.length);
}

async function buildVariant(name, mutation) {
  const variantRoot = path.join(tempRoot, name);
  const sourceRoot = path.join(variantRoot, "src");
  await fs.mkdir(sourceRoot, { recursive: true });
  const normalize = (text) => text.replace(/\r\n/gu, "\n");
  let extensionSource = normalize(await fs.readFile(extensionSourcePath, "utf8"));
  let hookSource = normalize(await fs.readFile(hookSourcePath, "utf8"));
  const validatorSource = normalize(await fs.readFile(validatorSourcePath, "utf8"));
  let requirementSource = normalize(await fs.readFile(requirementSourcePath, "utf8"));

  hookSource = replaceExactlyOnce(
    hookSource,
    `  handleContext(event: ContextEvent, ctx: ExtensionContext): ContextEventResult | undefined {
    const sessionId = ctx.sessionManager.getSessionId();`,
    `  handleContext(event: ContextEvent, ctx: ExtensionContext): ContextEventResult | undefined {
    const probe = globalThis[Symbol.for("omp-plan-kit:test:broker-calls")] as { calls: number } | undefined;
    if (probe) probe.calls += 1;
    const sessionId = ctx.sessionManager.getSessionId();`,
    `${name}: broker instrumentation`,
  );
  if (mutation?.target === "extension") {
    extensionSource = replaceExactlyOnce(extensionSource, mutation.from, mutation.to, mutation.id);
  } else if (mutation?.target === "requirement") {
    requirementSource = replaceExactlyOnce(requirementSource, mutation.from, mutation.to, mutation.id);
  } else if (mutation) {
    hookSource = replaceExactlyOnce(hookSource, mutation.from, mutation.to, mutation.id);
  }

  await Promise.all([
    fs.writeFile(path.join(sourceRoot, "extension.ts"), extensionSource, "utf8"),
    fs.writeFile(path.join(sourceRoot, "plan-mode-hook.ts"), hookSource, "utf8"),
    fs.writeFile(path.join(sourceRoot, "plan-validator.ts"), validatorSource, "utf8"),
    fs.writeFile(path.join(sourceRoot, "plan-core-requirement.ts"), requirementSource, "utf8"),
  ]);
  const outfile = path.join(variantRoot, "extension.js");
  const build = spawnSync("bun", [
    "build",
    path.join(sourceRoot, "extension.ts"),
    "--outfile",
    outfile,
    "--target",
    "bun",
    "--format",
    "esm",
    "--external",
    "@oh-my-pi/pi-ai",
  ], { cwd: repoRoot, encoding: "utf8" });
  assert.equal(build.status, 0, `${name}: mutant must compile before behavior is evaluated: ${build.stderr || build.stdout}`);
  return outfile;
}

function customMessage(customType, content) {
  return {
    role: "custom",
    customType,
    content,
    display: false,
    attribution: "agent",
    timestamp: Date.now(),
  };
}

function userMessage(content) {
  return { role: "user", content, timestamp: Date.now() };
}

async function dispatchContext(loaded, messages, ctx) {
  let current = messages;
  for (const extension of loaded.extensions) {
    for (const handler of extension.handlers.get("context") ?? []) {
      const result = await handler({ type: "context", messages: current }, ctx);
      if (result?.messages) current = result.messages;
    }
  }
  return current;
}

async function dispatchShutdown(loaded, ctx) {
  for (const extension of loaded.extensions) {
    for (const handler of extension.handlers.get("session_shutdown") ?? []) {
      await handler({ type: "session_shutdown" }, ctx);
    }
  }
}

function instructions(messages) {
  return messages.filter(
    (message) => message?.role === "custom"
      && message.customType === "omp-plan-kit:plan-mode-instruction",
  );
}

async function runContract(bundlePath, externalPluginPath, name) {
  globalThis[probeKey] = { calls: 0 };
  globalThis[consumerKey] = { events: 0 };
  const extensionModule = await loadLegacyPiModule(bundlePath);
  assert.equal(typeof extensionModule.PLAN_CORE_TEMPLATE, "string", `${name}: bundle must export the plan-core template`);
  const loaded = await loadExtensions([bundlePath, externalPluginPath], repoRoot);
  assert.deepEqual(loaded.errors, [], `${name}: real OMP loader errors: ${JSON.stringify(loaded.errors)}`);
  const sessionId = `mutation-${name}-${process.pid}`;
  const artifactsDir = path.join(tempRoot, sessionId);
  const localRoot = path.join(artifactsDir, "local");
  await fs.mkdir(localRoot, { recursive: true });
  const ctx = {
    sessionManager: { getSessionId: () => sessionId, getBranch: () => [] },
    localProtocolOptions: { getArtifactsDir: () => artifactsDir, getSessionId: () => sessionId },
    hasUI: false,
    ui: { notify() {} },
  };
  let failure = null;
  try {
    const unrelated = [customMessage("goal-mode-context", "not plan mode"), userMessage("ordinary")];
    const unrelatedResult = await dispatchContext(loaded, unrelated, ctx);
    assert.strictEqual(
      unrelatedResult,
      unrelated,
      "exact customType detection must ignore non-plan custom messages",
    );
    assert.equal(globalThis[consumerKey].events, 0, "exact customType detection must not publish entry");

    const planInput = [customMessage("plan-mode-context", "native plan rules"), userMessage("draft")];
    const first = await dispatchContext(loaded, planInput, ctx);
    const firstInstructions = instructions(first);
    assert.deepEqual(
      firstInstructions.map((message) => message.details?.id),
      ["omp-plan-kit:format-contract", "mutation-consumer:rules"],
      "shared event bus must collect both built-in and external instructions",
    );
    assert.equal(globalThis[consumerKey].events, 1);
    const builtIn = firstInstructions.find((message) => message.details?.id === "omp-plan-kit:format-contract");
    assert.ok(
      builtIn?.content.includes(extensionModule.PLAN_CORE_TEMPLATE),
      "built-in instruction must contain the exact exported plan-core template",
    );

    const markdownOnlyPlan = [
      "## Context",
      "Activated Plan Mode session without a machine-readable core.",
      "## Approach",
      "1. Update `src/feature.ts` with the required behavior.",
      "## Verification",
      "- `bun test` -> exit code 0",
    ].join("\n");
    await fs.writeFile(path.join(localRoot, "strict-plan.md"), markdownOnlyPlan, "utf8");
    const kit = loaded.extensions.find((extension) => (extension.handlers.get("tool_call") ?? []).length === 1);
    assert.ok(kit, "OMP Plan Kit proposal guard must load");
    const proposal = await kit.handlers.get("tool_call")[0]({
      toolName: "write",
      toolCallId: `${name}-strict-proposal`,
      input: { path: "xd://propose", content: "strict-plan" },
    }, ctx);
    assert.equal(proposal?.block, true, "activated session must require machine-readable plan core");
    assert.match(proposal.reason, /PLAN_CORE_REQUIRED/);

    const repeated = await dispatchContext(loaded, first, ctx);
    assert.equal(globalThis[consumerKey].events, 1, "one enter event per activation");
    const repeatedIds = instructions(repeated).map((message) => message.details?.id);
    assert.equal(repeatedIds.filter((id) => id === "omp-plan-kit:format-contract").length, 1, "repeated context must contain one instruction per ID");
    assert.equal(repeatedIds.filter((id) => id === "mutation-consumer:rules").length, 1, "repeated context must contain one instruction per ID");
  } catch (error) {
    failure = String(error?.message ?? error).split("\n")[0];
  } finally {
    await dispatchShutdown(loaded, ctx);
  }
  const brokerCalls = globalThis[probeKey].calls;
  assert.ok(brokerCalls > 0, `${name}: real broker call count must be non-zero`);
  return { failure, brokerCalls };
}

const externalPluginPath = path.join(tempRoot, "mutation-consumer.mjs");
await fs.writeFile(externalPluginPath, `export default function mutationConsumer(pi) {
  pi.events.on("omp-plan-kit:enter-plan-mode", (raw) => {
    const state = globalThis[Symbol.for("omp-plan-kit:test:mutation-consumer")];
    state.events += 1;
    raw.addInstruction({ id: "mutation-consumer:rules", content: "external mutation probe" });
  });
}
`, "utf8");

const mutantResults = [];
try {
  const baselineBundle = await buildVariant("baseline", null);
  const baseline = await runContract(baselineBundle, externalPluginPath, "baseline");
  assert.equal(baseline.failure, null, `baseline contract failed: ${baseline.failure}`);

  for (const mutation of mutations) {
    const bundle = await buildVariant(mutation.id, mutation);
    const result = await runContract(bundle, externalPluginPath, mutation.id);
    assert.ok(result.failure, `${mutation.id} survived its behavior contract`);
    assert.match(result.failure, mutation.expectedFailure, `${mutation.id} died for the wrong reason`);
    mutantResults.push({
      id: mutation.id,
      why: mutation.why,
      killed: true,
      killedBy: result.failure,
      brokerCalls: result.brokerCalls,
    });
  }

  console.log(JSON.stringify({
    schema: "omp-plan-mode-hook-mutations@1",
    decision: "pass",
    baselineBrokerCalls: baseline.brokerCalls,
    mutants: mutantResults,
  }, null, 2));
} finally {
  delete globalThis[probeKey];
  delete globalThis[consumerKey];
  await fs.rm(tempRoot, { recursive: true, force: true });
}
