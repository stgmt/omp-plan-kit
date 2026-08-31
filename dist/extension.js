// @bun
// src/extension.ts
import crypto from "crypto";
import * as fs from "fs/promises";
import os from "os";
import path from "path";
import { complete } from "@oh-my-pi/pi-ai";
var PROPOSE_PATH = "xd://propose";
var PLAN_SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/u;
var LOCAL_ROOT = path.join(os.tmpdir(), "omp-local");
var WINDOWS_LOCAL_ROOT_MAX_CHARS = 180;
var RECEIPT_PATH = path.join(os.homedir(), ".omp", "agent", "omp-plan-kit-receipts.ndjson");
var MAX_ADVISOR_CALLS = boundedNumber(process.env.OMP_PLAN_ADVISOR_MAX_CALLS, 2, 0, 10);
var ADVISOR_COOLDOWN_MS = boundedNumber(process.env.OMP_PLAN_ADVISOR_COOLDOWN_MS, 120000, 0, 86400000);
var ADVISOR_TIMEOUT_MS = boundedNumber(process.env.OMP_PLAN_ADVISOR_TIMEOUT_MS, 3000, 500, 30000);
var ADVISOR_MAX_TOKENS = boundedNumber(process.env.OMP_PLAN_ADVISOR_MAX_TOKENS, 160, 32, 256);
var ADVISOR_MAX_OUTPUT_CHARS = 600;
var HOST_SCOPE_TERMS = ["upstream", "authority", "providerKind", "serverId", "registrySnapshot", "deny-list"];
var NEGATIVE_SCOPE_RE = /(?:\u0432\u044B\u043F\u0438\u043B\w*|\u0443\u0431\u0435\u0440\w*|\u043D\u0435\s+(?:\u043D\u0430\u0434\u043E|\u043D\u0443\u0436\u043D\u043E|\u043D\u0443\u0436\w*|\u0434\u0435\u043B\w*|\u0442\u0440\u043E\u0433\w*)|\u043D\u0435\s+\u0445\u043E\u0447\w*|\u0437\u0430\u043F\u0440\u0435\u0442\w*|do\s+not|don't|not\s+needed|no\s+need|remove)/iu;
var DESIGN_SCOPE_RE = /(authority|providerKind|serverId|registrySnapshot|upstream|deny[- ]list|\u0430\u0440\u0445\u0438\u0442\u0435\u043A\u0442\u0443\u0440\w*|\u0434\u043E\u0440\u0430\u0431\u043E\u0442\w*\s+OMP)/iu;
function boundedNumber(raw, fallback, min, max) {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function sessionIdFrom(ctx) {
  return ctx.sessionManager.getSessionId();
}
function stateFor(states, sessionId) {
  const existing = states.get(sessionId);
  if (existing)
    return existing;
  const created = { forbiddenTerms: [], calls: 0, lastCallAt: 0, signatures: new Set };
  states.set(sessionId, created);
  return created;
}
function compact(value, maxChars) {
  return String(value ?? "").replace(/\s+/gu, " ").trim().slice(0, maxChars);
}
function redact(value, maxChars) {
  return compact(value, maxChars).replace(/\b(?:ghp|github_pat)_[A-Za-z0-9_]+\b/giu, "[REDACTED]").replace(/\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|password)\s*[:=]\s*[^\s]+/giu, "$1=[REDACTED]");
}
function parseSlug(payload) {
  if (typeof payload !== "string" || payload.trim() !== payload || !PLAN_SLUG_RE.test(payload))
    return null;
  const slug = payload.replace(/-plan$/iu, "") || payload;
  return { slug, planUrl: `local://${slug}-plan.md` };
}
function safeSessionId(sessionId) {
  return sessionId.replace(/[^A-Za-z0-9_.-]/gu, "_") || "session";
}
function resolveLocalRoot(sessionId, options) {
  const artifactsDir = options?.getArtifactsDir?.();
  if (artifactsDir) {
    const candidate = path.resolve(artifactsDir, "local");
    if (process.platform === "win32" && candidate.length >= WINDOWS_LOCAL_ROOT_MAX_CHARS) {
      return path.resolve(LOCAL_ROOT, safeSessionId(sessionId));
    }
    return candidate;
  }
  return path.resolve(LOCAL_ROOT, safeSessionId(sessionId));
}
function localPlanPath(planUrl, sessionId, options) {
  if (!planUrl.startsWith("local://"))
    return null;
  const relative = planUrl.slice("local://".length).replace(/[\\/]+/gu, path.sep);
  if (!relative || relative.includes(`..${path.sep}`) || path.isAbsolute(relative))
    return null;
  const root = resolveLocalRoot(sessionId, options);
  const candidate = path.resolve(root, relative);
  const rel = path.relative(root, candidate);
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel))
    return null;
  return candidate;
}
async function preflightProposal(payload, sessionId, options) {
  const parsed = parseSlug(payload);
  if (!parsed) {
    return { ok: false, code: "NON_SLUG_PAYLOAD", reason: "xd://propose accepts one plan slug; full Markdown is rejected before dispatch" };
  }
  if (!sessionId)
    return { ok: false, code: "SESSION_ID_MISSING", reason: "cannot bind proposal to an OMP session" };
  const planPath = localPlanPath(parsed.planUrl, sessionId, options);
  if (!planPath)
    return { ok: false, code: "PLAN_PATH_UNSAFE", reason: `refused unsafe plan path ${parsed.planUrl}` };
  try {
    const stat2 = await fs.stat(planPath);
    if (!stat2.isFile())
      return { ok: false, code: "PLAN_FILE_NOT_REGULAR", reason: `plan artifact is not a regular file: ${parsed.planUrl}` };
    const bytes = await fs.readFile(planPath);
    return { ok: true, ...parsed, planPath, bytes: bytes.byteLength, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
  } catch {
    return { ok: false, code: "PLAN_FILE_MISSING", reason: `exact plan artifact is missing: ${parsed.planUrl}; fallback is disabled` };
  }
}
function extractForbiddenTerms(prompt) {
  if (!NEGATIVE_SCOPE_RE.test(prompt) || !DESIGN_SCOPE_RE.test(prompt))
    return [];
  const lower = prompt.toLowerCase();
  return HOST_SCOPE_TERMS.filter((term) => lower.includes(term.toLowerCase()));
}
function signature(kind, detail) {
  return crypto.createHash("sha256").update(`${kind}
${detail}`).digest("hex").slice(0, 16);
}
async function writeReceipt(data) {
  try {
    await fs.mkdir(path.dirname(RECEIPT_PATH), { recursive: true });
    await fs.appendFile(RECEIPT_PATH, `${JSON.stringify({ timestamp: new Date().toISOString(), ...data })}
`, "utf8");
  } catch {}
}
function resolveAdvisorModel(ctx) {
  const spec = process.env.OMP_PLAN_ADVISOR_MODEL?.trim() || "@advisor";
  return ctx.models.resolve(spec) ?? ctx.models.current();
}
async function advise(ctx, state, kind, detail, hardBlocked, completeImpl) {
  const sessionId = sessionIdFrom(ctx);
  const key = signature(kind, detail);
  const enabled = (process.env.OMP_PLAN_ADVISOR ?? "1").toLowerCase() !== "0";
  const now = Date.now();
  if (!enabled || MAX_ADVISOR_CALLS === 0) {
    await writeReceipt({ sessionId, kind, key, hardBlocked, llm: "disabled" });
    return;
  }
  if (state.calls >= MAX_ADVISOR_CALLS || now - state.lastCallAt < ADVISOR_COOLDOWN_MS || state.signatures.has(key)) {
    await writeReceipt({ sessionId, kind, key, hardBlocked, llm: "budget-suppressed" });
    return;
  }
  const model = resolveAdvisorModel(ctx);
  if (!model) {
    await writeReceipt({ sessionId, kind, key, hardBlocked, llm: "model-unavailable" });
    return;
  }
  const apiKey = await ctx.modelRegistry.getApiKey(model);
  if (!apiKey) {
    await writeReceipt({ sessionId, kind, key, hardBlocked, llm: "credential-unavailable", provider: model.provider, model: model.id });
    return;
  }
  state.calls += 1;
  state.lastCallAt = now;
  state.signatures.add(key);
  const prompt = [
    "You are a narrow plan-handoff safety reviewer.",
    "Return at most two concrete bullets, max 80 words, no preamble, and do not rewrite code.",
    `Event: ${kind}. Hard guard blocked: ${hardBlocked}.`,
    `Evidence: ${redact(detail, 500)}.`,
    "Focus only on the exact artifact, slug, or revision that must be verified next."
  ].join(`
`);
  try {
    const response = await completeImpl(model, {
      messages: [{ role: "user", content: [{ type: "text", text: prompt }], timestamp: Date.now() }]
    }, { apiKey, maxTokens: ADVISOR_MAX_TOKENS, disableReasoning: true, signal: AbortSignal.timeout(ADVISOR_TIMEOUT_MS) });
    const text = response.content.filter((block) => block.type === "text").map((block) => block.text).join(" ").trim().slice(0, ADVISOR_MAX_OUTPUT_CHARS);
    await writeReceipt({ sessionId, kind, key, hardBlocked, llm: text ? "ok" : "empty", provider: model.provider, model: model.id, outputChars: text.length, usage: isRecord(response.usage) ? response.usage : undefined });
    if (text && ctx.hasUI)
      ctx.ui.notify(`Plan advisor: ${text}`, hardBlocked ? "warning" : "info");
  } catch (error) {
    await writeReceipt({ sessionId, kind, key, hardBlocked, llm: "failed", provider: model.provider, model: model.id, error: error instanceof Error ? error.name : String(error) });
  }
}
function createPlanProtectionForTest(dependencies = {}) {
  const states = new Map;
  const completeImpl = dependencies.complete ?? complete;
  return {
    async handleToolCall(event, ctx) {
      const sessionId = sessionIdFrom(ctx);
      const state = stateFor(states, sessionId);
      if (event.toolName === "write" && event.input?.path === PROPOSE_PATH) {
        const check = await preflightProposal(event.input.content, sessionId, ctx.localProtocolOptions);
        if (!check.ok) {
          advise(ctx, state, "invalid-proposal", `${check.code}: ${check.reason}`, true, completeImpl).catch(() => {
            return;
          });
          return { block: true, reason: `[PLAN_HANDOFF_${check.code}] ${check.reason}` };
        }
        writeReceipt({ sessionId, kind: "proposal-preflight", hardBlocked: false, planUrl: check.planUrl, bytes: check.bytes, sha256: check.sha256 }).catch(() => {
          return;
        });
        return;
      }
      if (event.toolName === "todo") {
        const todoText = JSON.stringify(event.input ?? {});
        const matched = state.forbiddenTerms.find((term) => todoText.toLowerCase().includes(term.toLowerCase()));
        if (matched)
          advise(ctx, state, "todo-scope-suspicion", `rejected term ${matched} appears in todo update`, false, completeImpl).catch(() => {
            return;
          });
      }
      return;
    },
    async handleAgentStart(event, ctx) {
      stateFor(states, sessionIdFrom(ctx)).forbiddenTerms = extractForbiddenTerms(event.prompt ?? "");
    }
  };
}
function planProtection(pi) {
  pi.setLabel("OMP Plan Kit");
  const policy = createPlanProtectionForTest();
  pi.on("before_agent_start", async (event, ctx) => policy.handleAgentStart(event, ctx));
  pi.on("tool_call", async (event, ctx) => policy.handleToolCall(event, ctx));
}
export {
  planProtection as default,
  createPlanProtectionForTest
};
