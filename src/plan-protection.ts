import crypto from "node:crypto";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { complete } from "@oh-my-pi/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import type { Model } from "@oh-my-pi/pi-ai";

const PROPOSE_PATH = "xd://propose";
const PLAN_SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/u;
const LOCAL_ROOT = path.join(os.tmpdir(), "omp-local");
const WINDOWS_LOCAL_ROOT_MAX_CHARS = 180;
const MAX_ADVISOR_CALLS = boundedNumber(process.env.OMP_PLAN_ADVISOR_MAX_CALLS, 2, 0, 10);
const ADVISOR_COOLDOWN_MS = boundedNumber(process.env.OMP_PLAN_ADVISOR_COOLDOWN_MS, 120_000, 0, 86_400_000);
const ADVISOR_TIMEOUT_MS = boundedNumber(process.env.OMP_PLAN_ADVISOR_TIMEOUT_MS, 3_000, 500, 30_000);
const ADVISOR_MAX_TOKENS = boundedNumber(process.env.OMP_PLAN_ADVISOR_MAX_TOKENS, 160, 32, 256);
const ADVISOR_MAX_OUTPUT_CHARS = 600;
const HOST_SCOPE_TERMS = ["upstream", "authority", "providerKind", "serverId", "registrySnapshot", "deny-list"];
const NEGATIVE_SCOPE_RE = /(?:выпил\w*|убер\w*|не\s+(?:надо|нужно|нуж\w*|дел\w*|трог\w*)|не\s+хоч\w*|запрет\w*|do\s+not|don't|not\s+needed|no\s+need|remove)/iu;
const DESIGN_SCOPE_RE = /(authority|providerKind|serverId|registrySnapshot|upstream|deny[- ]list|архитектур\w*|доработ\w*\s+OMP)/iu;

type SessionState = {
  forbiddenTerms: string[];
  calls: number;
  lastCallAt: number;
  signatures: Set<string>;
};

type GuardResult = { block: true; reason: string } | undefined;

type ProposalCheck =
  | { ok: true; slug: string; planUrl: string; planPath: string; bytes: number; sha256: string }
  | { ok: false; code: string; reason: string };

type CompleteFn = typeof complete;

type TestDependencies = {
  complete?: CompleteFn;
};

function boundedNumber(raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sessionIdFrom(ctx: ExtensionContext): string {
  return ctx.sessionManager.getSessionId();
}

function stateFor(states: Map<string, SessionState>, sessionId: string): SessionState {
  const existing = states.get(sessionId);
  if (existing) return existing;
  const created: SessionState = { forbiddenTerms: [], calls: 0, lastCallAt: 0, signatures: new Set() };
  states.set(sessionId, created);
  return created;
}

function compact(value: unknown, maxChars: number): string {
  return String(value ?? "").replace(/\s+/gu, " ").trim().slice(0, maxChars);
}

function redact(value: unknown, maxChars: number): string {
  return compact(value, maxChars)
    .replace(/\b(?:ghp|github_pat)_[A-Za-z0-9_]+\b/giu, "[REDACTED]")
    .replace(/\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|password)\s*[:=]\s*[^\s]+/giu, "$1=[REDACTED]");
}

function parseSlug(payload: unknown): { slug: string; planUrl: string } | null {
  if (typeof payload !== "string" || payload.trim() !== payload || !PLAN_SLUG_RE.test(payload)) return null;
  const slug = payload.replace(/-plan$/iu, "") || payload;
  return { slug, planUrl: `local://${slug}-plan.md` };
}

function safeSessionId(sessionId: string): string {
  return sessionId.replace(/[^A-Za-z0-9_.-]/gu, "_") || "session";
}

type LocalProtocolOptions = {
  getArtifactsDir?: () => string | null;
};

function resolveLocalRoot(sessionId: string, options?: LocalProtocolOptions): string {
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

function localPlanPath(planUrl: string, sessionId: string, options?: LocalProtocolOptions): string | null {
  if (!planUrl.startsWith("local://")) return null;
  const relative = planUrl.slice("local://".length).replace(/[\\/]+/gu, path.sep);
  if (!relative || relative.includes(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  const root = resolveLocalRoot(sessionId, options);
  const candidate = path.resolve(root, relative);
  const rel = path.relative(root, candidate);
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
  return candidate;
}

async function preflightProposal(payload: unknown, sessionId: string, options?: LocalProtocolOptions): Promise<ProposalCheck> {
  const parsed = parseSlug(payload);
  if (!parsed) {
    return { ok: false, code: "NON_SLUG_PAYLOAD", reason: "xd://propose accepts one plan slug; full Markdown is rejected before dispatch" };
  }
  if (!sessionId) return { ok: false, code: "SESSION_ID_MISSING", reason: "cannot bind proposal to an OMP session" };
  const planPath = localPlanPath(parsed.planUrl, sessionId, options);
  if (!planPath) return { ok: false, code: "PLAN_PATH_UNSAFE", reason: `refused unsafe plan path ${parsed.planUrl}` };
  try {
    const stat = await fs.stat(planPath);
    if (!stat.isFile()) return { ok: false, code: "PLAN_FILE_NOT_REGULAR", reason: `plan artifact is not a regular file: ${parsed.planUrl}` };
    const bytes = await fs.readFile(planPath);
    return { ok: true, ...parsed, planPath, bytes: bytes.byteLength, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
  } catch {
    return { ok: false, code: "PLAN_FILE_MISSING", reason: `exact plan artifact is missing: ${parsed.planUrl}; fallback is disabled` };
  }
}

function extractForbiddenTerms(prompt: string): string[] {
  if (!NEGATIVE_SCOPE_RE.test(prompt) || !DESIGN_SCOPE_RE.test(prompt)) return [];
  const lower = prompt.toLowerCase();
  return HOST_SCOPE_TERMS.filter((term) => lower.includes(term.toLowerCase()));
}

function signature(kind: string, detail: string): string {
  return crypto.createHash("sha256").update(`${kind}\n${detail}`).digest("hex").slice(0, 16);
}

async function writeReceipt(data: Record<string, unknown>): Promise<void> {
  try {
    await fs.mkdir(path.dirname(RECEIPT_PATH), { recursive: true });
    await fs.appendFile(RECEIPT_PATH, `${JSON.stringify({ timestamp: new Date().toISOString(), ...data })}\n`, "utf8");
  } catch {
    // Observability must not weaken the hard guard.
  }
}

function resolveAdvisorModel(ctx: ExtensionContext): Model | undefined {
  const spec = process.env.OMP_PLAN_ADVISOR_MODEL?.trim() || "@advisor";
  return ctx.models.resolve(spec) ?? ctx.models.current();
}

async function advise(
  ctx: ExtensionContext,
  state: SessionState,
  kind: string,
  detail: string,
  hardBlocked: boolean,
  completeImpl: CompleteFn,
): Promise<void> {
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
    "Focus only on the exact artifact, slug, or revision that must be verified next.",
  ].join("\n");
  try {
    const response = await completeImpl(
      model,
      {
        messages: [{ role: "user", content: [{ type: "text", text: prompt }], timestamp: Date.now() }],
      },
      { apiKey, maxTokens: ADVISOR_MAX_TOKENS, disableReasoning: true, signal: AbortSignal.timeout(ADVISOR_TIMEOUT_MS) },
    );
    const text = response.content.filter((block) => block.type === "text").map((block) => block.text).join(" ").trim().slice(0, ADVISOR_MAX_OUTPUT_CHARS);
    await writeReceipt({ sessionId, kind, key, hardBlocked, llm: text ? "ok" : "empty", provider: model.provider, model: model.id, outputChars: text.length, usage: isRecord(response.usage) ? response.usage : undefined });
    if (text && ctx.hasUI) ctx.ui.notify(`Plan advisor: ${text}`, hardBlocked ? "warning" : "info");
  } catch (error) {
    await writeReceipt({ sessionId, kind, key, hardBlocked, llm: "failed", provider: model.provider, model: model.id, error: error instanceof Error ? error.name : String(error) });
  }
}

export function createPlanProtectionForTest(dependencies: TestDependencies = {}) {
  const states = new Map<string, SessionState>();
  const completeImpl = dependencies.complete ?? complete;
  return {
    async handleToolCall(event: { toolName?: string; toolCallId?: string; input?: Record<string, unknown> }, ctx: ExtensionContext): Promise<GuardResult> {
      const sessionId = sessionIdFrom(ctx);
      const state = stateFor(states, sessionId);
      if (event.toolName === "write" && event.input?.path === PROPOSE_PATH) {
        const check = await preflightProposal(event.input.content, sessionId, ctx.localProtocolOptions);
        if (!check.ok) {
          void advise(ctx, state, "invalid-proposal", `${check.code}: ${check.reason}`, true, completeImpl).catch(() => undefined);
          return { block: true, reason: `[PLAN_HANDOFF_${check.code}] ${check.reason}` };
        }
        void writeReceipt({ sessionId, kind: "proposal-preflight", hardBlocked: false, planUrl: check.planUrl, bytes: check.bytes, sha256: check.sha256 }).catch(() => undefined);
        return undefined;
      }
      if (event.toolName === "todo") {
        const todoText = JSON.stringify(event.input ?? {});
        const matched = state.forbiddenTerms.find((term) => todoText.toLowerCase().includes(term.toLowerCase()));
        if (matched) void advise(ctx, state, "todo-scope-suspicion", `rejected term ${matched} appears in todo update`, false, completeImpl).catch(() => undefined);
      }
      return undefined;
    },
    async handleAgentStart(event: { prompt?: string }, ctx: ExtensionContext): Promise<void> {
      stateFor(states, sessionIdFrom(ctx)).forbiddenTerms = extractForbiddenTerms(event.prompt ?? "");
    },
  };
}

export default function planProtection(pi: ExtensionAPI): void {
  pi.setLabel("Plan protection");
  const policy = createPlanProtectionForTest();
  pi.on("before_agent_start", async (event, ctx) => policy.handleAgentStart(event, ctx));
  pi.on("tool_call", async (event, ctx) => policy.handleToolCall(event, ctx));
}
