import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const home = os.homedir();
const extensionPath = path.join(process.cwd(), "dist", "extension.js");
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
const extensionModule = await import(pathToFileURL(extensionPath).href);

assert.equal(extensionModule.ENTER_PLAN_MODE_CHANNEL, "omp-plan-kit:enter-plan-mode");
assert.equal(typeof extensionModule.isEnterPlanModeEventV1, "function");
assert.equal(extensionModule.isEnterPlanModeEventV1({
  apiVersion: 1,
  sessionId: "session",
  activationId: "activation",
  addInstruction() {},
}), true);
assert.equal(extensionModule.isEnterPlanModeEventV1({ apiVersion: 2 }), false);

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omp-plan-mode-hook-"));
const globalKeys = [];
const results = [];

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

function modeChange(id, mode, planFilePath) {
  return {
    type: "mode_change",
    id,
    parentId: null,
    timestamp: new Date().toISOString(),
    mode,
    ...(planFilePath ? { data: { planFilePath } } : {}),
  };
}

function makeContext(sessionId, branch) {
  return {
    sessionManager: {
      getSessionId: () => sessionId,
      getBranch: () => branch,
    },
    hasUI: false,
    ui: { notify() {} },
  };
}

async function dispatchEvent(loaded, name, event, ctx) {
  for (const extension of loaded.extensions) {
    for (const handler of extension.handlers.get(name) ?? []) {
      await handler(event, ctx);
    }
  }
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

function instructionMessages(messages) {
  return messages.filter(
    (message) => message?.role === "custom"
      && message.customType === "omp-plan-kit:plan-mode-instruction",
  );
}

function countInstruction(messages, id) {
  return instructionMessages(messages).filter((message) => message.details?.id === id).length;
}

function assertPlanInstructions(messages, expectedOrder) {
  const instructions = instructionMessages(messages);
  assert.deepEqual(
    instructions.map((message) => message.details?.id),
    expectedOrder,
    "instructions must retain shared-bus listener order",
  );
  assert.equal(countInstruction(messages, "omp-plan-kit:format-contract"), 1);
  assert.equal(countInstruction(messages, "external-test:rules"), 1);
  assert.equal(countInstruction(messages, "external-test:late"), 0);
  const external = instructions.find((message) => message.details?.id === "external-test:rules");
  assert.equal(external?.content, "first external instruction", "duplicate IDs must retain first content");
  const builtIn = instructions.find((message) => message.details?.id === "omp-plan-kit:format-contract");
  assert.ok(builtIn?.content.includes(extensionModule.PLAN_CORE_TEMPLATE), "built-in instruction must contain the byte-exact plan-core template");
  assert.match(builtIn?.content ?? "", /MUST begin at line 1/);
  assert.match(builtIn?.content ?? "", /keep all JSON key names unchanged/i);
  for (const message of instructions) {
    assert.equal(message.display, false);
    assert.equal(message.attribution, "agent");
    assert.equal(message.details?.apiVersion, 1);
  }
  const markerIndex = messages.findIndex((message) => message?.customType === "plan-mode-context");
  assert.ok(markerIndex >= 0);
  assert.deepEqual(
    messages.slice(markerIndex + 1, markerIndex + 1 + instructions.length),
    instructions,
    "instructions must be inserted immediately after native plan context",
  );
}

async function makeExternalPlugin(name) {
  const stateKey = `__ompPlanModeHookE2E_${process.pid}_${Date.now()}_${name.replace(/\W/gu, "_")}`;
  globalKeys.push(stateKey);
  globalThis[stateKey] = { events: [], lateAttempts: 0 };
  const pluginPath = path.join(tempRoot, `external-${name}.mjs`);
  await fs.writeFile(pluginPath, `export default function externalPlanModeConsumer(pi) {
  const state = globalThis[${JSON.stringify(stateKey)}];
  pi.events.on("omp-plan-kit:enter-plan-mode", (raw) => {
    state.events.push({
      apiVersion: raw.apiVersion,
      sessionId: raw.sessionId,
      activationId: raw.activationId,
      planFilePath: raw.planFilePath,
    });
    raw.addInstruction({ id: "external-test:rules", content: "first external instruction" });
    raw.addInstruction({ id: "external-test:rules", content: "duplicate must lose" });
  });
  pi.events.on("omp-plan-kit:enter-plan-mode", () => {
    throw new Error("intentional subscriber failure");
  });
  pi.events.on("omp-plan-kit:enter-plan-mode", async (raw) => {
    await Promise.resolve();
    state.lateAttempts += 1;
    raw.addInstruction({ id: "external-test:late", content: "must be rejected" });
  });
}
`, "utf8");
  return { pluginPath, state: globalThis[stateKey] };
}

async function loadScenario(name, order) {
  const external = await makeExternalPlugin(name);
  const paths = order === "external-first"
    ? [external.pluginPath, extensionPath]
    : [extensionPath, external.pluginPath];
  const loaded = await loadExtensions(paths, process.cwd());
  assert.deepEqual(loaded.errors, [], `real OMP loader errors: ${JSON.stringify(loaded.errors)}`);
  const kit = loaded.extensions.find((extension) => (extension.handlers.get("tool_call") ?? []).length === 1);
  assert.ok(kit, "OMP Plan Kit extension must load");
  assert.equal(kit.handlers.get("before_agent_start")?.length, 1);
  assert.equal(kit.handlers.get("context")?.length, 1);
  assert.equal(kit.handlers.get("tool_call")?.length, 1, "proposal guard registration must stay unchanged");
  assert.equal(kit.handlers.get("session_shutdown")?.length, 1);
  return { ...external, loaded };
}

async function flushEventBus() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function runJournalScenario(order) {
  const name = `journal-${order}`;
  const { loaded, state } = await loadScenario(name, order);
  const sessionId = `plan-mode-journal-${order}-${process.pid}`;
  await fs.mkdir(path.join(tempRoot, sessionId), { recursive: true });
  const branch = [modeChange("plan-A", "plan", "local://alpha-plan.md")];
  const ctx = makeContext(sessionId, branch);
  const ordinary = [userMessage("ordinary request")];

  await dispatchEvent(loaded, "before_agent_start", { type: "before_agent_start", prompt: "plan", systemPrompt: [] }, ctx);
  const unchanged = await dispatchContext(loaded, ordinary, ctx);
  assert.strictEqual(unchanged, ordinary, "non-plan context array must be byte-identical and retain identity");
  assert.equal(state.events.length, 0);

  const planInput = [
    customMessage("plan-reference", "reference"),
    customMessage("plan-mode-context", "native plan instructions"),
    userMessage("draft the plan"),
  ];
  const first = await dispatchContext(loaded, planInput, ctx);
  await flushEventBus();
  assert.equal(state.events.length, 1, "first plan request must emit once");
  assert.deepEqual(state.events[0], {
    apiVersion: 1,
    sessionId,
    activationId: "plan-A",
    planFilePath: "local://alpha-plan.md",
  });
  const expectedOrder = order === "external-first"
    ? ["external-test:rules", "omp-plan-kit:format-contract"]
    : ["omp-plan-kit:format-contract", "external-test:rules"];
  assertPlanInstructions(first, expectedOrder);
  assert.equal(state.lateAttempts, 1);

  const repeated = await dispatchContext(loaded, first, ctx);
  await flushEventBus();
  assert.equal(state.events.length, 1, "same activation must not emit twice");
  assertPlanInstructions(repeated, expectedOrder);

  branch.push(modeChange("plan-B", "plan", "local://beta-plan.md"));
  await dispatchEvent(loaded, "before_agent_start", { type: "before_agent_start", prompt: "reenter", systemPrompt: [] }, ctx);
  const reentered = await dispatchContext(loaded, planInput, ctx);
  await flushEventBus();
  assert.equal(state.events.length, 2, "new plan journal ID must emit a new activation");
  assert.equal(state.events[1].activationId, "plan-B");
  assert.equal(state.events[1].planFilePath, "local://beta-plan.md");
  assertPlanInstructions(reentered, expectedOrder);

  branch.push(modeChange("plan-none", "none"));
  const afterExitInput = [userMessage("execute")];
  const afterExit = await dispatchContext(loaded, afterExitInput, ctx);
  assert.strictEqual(afterExit, afterExitInput, "context without native plan marker must reset without copying");

  branch.push(modeChange("plan-C", "plan", "local://gamma-plan.md"));
  const afterReset = await dispatchContext(loaded, planInput, ctx);
  await flushEventBus();
  assert.equal(state.events.length, 3, "marker after non-plan context must start a new activation");
  assert.equal(state.events[2].activationId, "plan-C");
  assertPlanInstructions(afterReset, expectedOrder);

  await dispatchEvent(loaded, "session_shutdown", { type: "session_shutdown" }, ctx);
  results.push({ name, events: state.events.length, lateAttempts: state.lateAttempts });
}

async function runFallbackScenario() {
  const { loaded, state } = await loadScenario("fallback", "kit-first");
  const sessionId = `plan-mode-fallback-${process.pid}`;
  await fs.mkdir(path.join(tempRoot, sessionId), { recursive: true });
  const branch = [];
  const ctx = makeContext(sessionId, branch);
  const planInput = [customMessage("plan-mode-context", "ACP plan instructions"), userMessage("plan")];

  const first = await dispatchContext(loaded, planInput, ctx);
  await flushEventBus();
  assert.equal(state.events.length, 1);
  assert.equal(state.events[0].activationId, "observation:1");
  assert.equal(state.events[0].planFilePath, undefined);
  assertPlanInstructions(first, ["omp-plan-kit:format-contract", "external-test:rules"]);

  const ordinary = [userMessage("not planning")];
  const unchanged = await dispatchContext(loaded, ordinary, ctx);
  assert.strictEqual(unchanged, ordinary);

  const second = await dispatchContext(loaded, planInput, ctx);
  await flushEventBus();
  assert.equal(state.events.length, 2);
  assert.equal(state.events[1].activationId, "observation:2");
  assertPlanInstructions(second, ["omp-plan-kit:format-contract", "external-test:rules"]);

  branch.push(modeChange("bound-after-observation", "plan", "local://bound-plan.md"));
  const bound = await dispatchContext(loaded, planInput, ctx);
  await flushEventBus();
  assert.equal(state.events.length, 2, "first journal ID observed during fallback activation must bind without re-emitting");
  assertPlanInstructions(bound, ["omp-plan-kit:format-contract", "external-test:rules"]);

  await dispatchEvent(loaded, "session_shutdown", { type: "session_shutdown" }, ctx);
  results.push({ name: "fallback", events: state.events.length, lateAttempts: state.lateAttempts });
}

try {
  await runJournalScenario("external-first");
  await runJournalScenario("kit-first");
  await runFallbackScenario();
  console.log(JSON.stringify({ status: "PASS", results }));
} finally {
  for (const key of globalKeys) delete globalThis[key];
  await fs.rm(tempRoot, { recursive: true, force: true });
}
