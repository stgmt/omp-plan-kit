import crypto from "node:crypto";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import {
  PLAN_CORE_TEMPLATE,
  type PlanIssue,
  formatRepairPacket,
  issueSignature,
  validatePlanStructure,
} from "./plan-validator.js";
import { PlanCoreRequirementRegistry } from "./plan-core-requirement.js";
import {
  ENTER_PLAN_MODE_CHANNEL,
  PlanModeHookBroker,
  isEnterPlanModeEventV1,
  type EnterPlanModeEventV1,
} from "./plan-mode-hook.js";

const PROPOSE_PATH = "xd://propose";
const PLAN_SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/u;
const LOCAL_ROOT = path.join(os.tmpdir(), "omp-local");
const WINDOWS_LOCAL_ROOT_MAX_CHARS = 180;
const RECEIPT_PATH = path.join(os.homedir(), ".omp", "agent", "omp-plan-kit-receipts.ndjson");
const MAX_FAILED_VALIDATIONS = 3;
const MAX_SAME_HASH_REPEATS = 2;
const MAX_NO_PROGRESS_ATTEMPTS = 2;
const MAX_TURN_PROPOSALS = 4;
const PLAN_MODE_FORMAT_CONTRACT = [
  "OMP Plan Kit mandatory plan-core contract:",
  "The plan MUST begin at line 1 with this exact JSON plan-core template:",
  PLAN_CORE_TEMPLATE,
  "Replace every placeholder value, but keep all JSON key names unchanged. Values may use any language.",
  "Before writing xd://propose, reread the complete plan artifact and resolve every listed validation defect.",
].join("\n");

export type ValidationCycle = {
  failedAttempts: number;
  lastSha256?: string;
  lastIssueSignature?: string;
  lastIssueCount?: number;
  lastIssues: PlanIssue[];
  sameHashCount: number;
  noProgressCount: number;
  blocked: boolean;
};

export type TurnValidationState = {
  turnId: number;
  proposalCount: number;
  blocked: boolean;
  cyclesBySlug: Map<string, ValidationCycle>;
};

type SessionState = {
  turnState: TurnValidationState;
};

type GuardResult = { block: true; reason: string } | undefined;

type ProposalCheck =
  | { ok: true; slug: string; planUrl: string; planPath: string; bytes: number; sha256: string }
  | { ok: false; code: string; reason: string };

export type TestDependencies = {
  validatePlan?: typeof validatePlanStructure;
  requiresPlanCore?: (sessionId: string) => boolean;
};

let activeTestDependencies: TestDependencies = {};

export function setTestDependencies(deps: TestDependencies): void {
  activeTestDependencies = deps;
}

function stateFor(states: Map<string, SessionState>, sessionId: string): SessionState {
  const existing = states.get(sessionId);
  if (existing) return existing;
  const created: SessionState = {
    turnState: {
      turnId: 0,
      proposalCount: 0,
      blocked: false,
      cyclesBySlug: new Map(),
    },
  };
  states.set(sessionId, created);
  return created;
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
    return {
      ok: false,
      code: "PLAN_FILE_MISSING",
      reason: `exact plan artifact is missing: ${parsed.planUrl}; fallback is disabled. If the plan file was written in the same tool-call batch as xd://propose, call xd://propose in a separate subsequent turn because OMP executes all tool_call hooks before writing files`,
    };
  }
}

async function writeReceipt(data: Record<string, unknown>): Promise<void> {
  try {
    await fs.mkdir(path.dirname(RECEIPT_PATH), { recursive: true });
    await fs.appendFile(RECEIPT_PATH, `${JSON.stringify({ timestamp: new Date().toISOString(), ...data })}\n`, "utf8");
  } catch {
    // Observability must not weaken the hard guard.
  }
}

export function createPlanProtectionForTest(dependencies: TestDependencies = {}) {
  const states = new Map<string, SessionState>();
  const requiresPlanCore = dependencies.requiresPlanCore
    ?? activeTestDependencies.requiresPlanCore
    ?? (() => false);
  return {
    async handleToolCall(event: { toolName?: string; toolCallId?: string; input?: Record<string, unknown> }, ctx: ExtensionContext): Promise<GuardResult> {
      const validatePlanImpl = dependencies.validatePlan ?? activeTestDependencies.validatePlan ?? validatePlanStructure;
      const sessionId = ctx.sessionManager.getSessionId();
      const state = stateFor(states, sessionId);

      // Trigger ONLY when proposing a plan (Plan Mode Exit / Handoff).
      // Intermediate tools (todo, read, edit) never affect proposal validation.
      if (event.toolName === "write" && event.input?.path === PROPOSE_PATH) {
        const turn = state.turnState;
        if (turn.blocked) {
          return {
            block: true,
            reason: "[PLAN_VALIDATOR_TURN_BLOCKED] Plan handoff budget exceeded for this user turn. Wait for user feedback or native Refine.",
          };
        }


        // Step 1: Deterministic check (0 tokens)
        const check = await preflightProposal(event.input.content, sessionId, ctx.localProtocolOptions);
        if (!check.ok) {
          return { block: true, reason: `[PLAN_HANDOFF_${check.code}] ${check.reason}` };
        }
        turn.proposalCount += 1;
        if (turn.proposalCount > MAX_TURN_PROPOSALS) {
          turn.blocked = true;
          return {
            block: true,
            reason: "[PLAN_VALIDATOR_TURN_BLOCKED] Plan handoff budget exceeded for this user turn. Too many proposals without progress; wait for user feedback or native Refine.",
          };
        }

        // Step 2: Read proposed plan artifact from disk
        const planContent = await fs.readFile(check.planPath, "utf8");

        let cycle = turn.cyclesBySlug.get(check.slug);
        if (!cycle) {
          cycle = {
            failedAttempts: 0,
            lastIssues: [],
            sameHashCount: 0,
            noProgressCount: 0,
            blocked: false,
          };
          turn.cyclesBySlug.set(check.slug, cycle);
        }

        // 1. If this slug cycle is already blocked, return immediately
        if (cycle.blocked) {
          return {
            block: true,
            reason: "[PLAN_VALIDATOR_BLOCKED] Automatic repair is stopped for this user turn. Do not call xd://propose again; wait for user feedback or native Refine.",
          };
        }

        // 2. Unchanged SHA check
        if (cycle.lastSha256 && check.sha256 === cycle.lastSha256) {
          cycle.failedAttempts += 1;
          cycle.sameHashCount += 1;

          if (cycle.sameHashCount >= MAX_SAME_HASH_REPEATS || cycle.failedAttempts >= MAX_FAILED_VALIDATIONS) {
            cycle.blocked = true;
            if (ctx.hasUI) {
              ctx.ui.notify(`Plan validation stopped for "${check.slug}": repeated unchanged plan without repair`, "error");
            }
            await writeReceipt({
              sessionId,
              kind: "VALIDATOR_STOPPED",
              slug: check.slug,
              sha256: check.sha256,
              attempt: cycle.failedAttempts,
              reason: "SAME_HASH_LIMIT_REACHED",
              issueCount: cycle.lastIssues.length,
              issues: cycle.lastIssues.map((i) => i.code),
            });
            return {
              block: true,
              reason: `[PLAN_VALIDATOR_STOPPED] Automatic plan validation stopped for "${check.slug}". Plan file was repeated without changes (${cycle.sameHashCount} times). Do not call xd://propose again; wait for user feedback or native Refine. Remaining issues:\n\n${formatRepairPacket(check.slug, cycle.lastIssues, cycle.failedAttempts, MAX_FAILED_VALIDATIONS)}`,
            };
          }

          await writeReceipt({
            sessionId,
            kind: "VALIDATOR_REJECT",
            slug: check.slug,
            sha256: check.sha256,
            attempt: cycle.failedAttempts,
            reason: "PLAN_FILE_UNCHANGED",
            issueCount: cycle.lastIssues.length,
            issues: cycle.lastIssues.map((i) => i.code),
          });

          return {
            block: true,
            reason: `[PLAN_VALIDATOR_BLOCK] Plan file is unchanged in local://${check.slug}-plan.md (Attempt ${cycle.failedAttempts} of ${MAX_FAILED_VALIDATIONS}). Previous validation issues remain:\n\n${formatRepairPacket(check.slug, cycle.lastIssues, cycle.failedAttempts, MAX_FAILED_VALIDATIONS)}`,
          };
        }

        // 3. Execute deterministic validation
        let issues: PlanIssue[];
        try {
          issues = validatePlanImpl(planContent, { requirePlanCore: requiresPlanCore(sessionId) });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          await writeReceipt({
            sessionId,
            kind: "VALIDATOR_INTERNAL_ERROR",
            slug: check.slug,
            sha256: check.sha256,
            error: errMsg,
          });
          return {
            block: true,
            reason: `[PLAN_VALIDATOR_INTERNAL_ERROR] Plan handoff is blocked because deterministic validation failed internally: ${errMsg}`,
          };
        }

        // 4. Handle validation failures
        if (issues.length > 0) {
          cycle.failedAttempts += 1;
          const signature = issueSignature(issues);
          const prevCount = cycle.lastIssueCount;
          const prevSignature = cycle.lastIssueSignature;

          if (prevCount !== undefined && issues.length < prevCount && signature !== prevSignature) {
            cycle.sameHashCount = 0;
            cycle.noProgressCount = 0;
          } else if (prevCount !== undefined) {
            cycle.noProgressCount += 1;
          }

          cycle.lastSha256 = check.sha256;
          cycle.lastIssueSignature = signature;
          cycle.lastIssueCount = issues.length;
          cycle.lastIssues = [...issues];

          // 5. Check limits
          const limitReached =
            cycle.failedAttempts >= MAX_FAILED_VALIDATIONS ||
            cycle.noProgressCount >= MAX_NO_PROGRESS_ATTEMPTS;

          if (limitReached) {
            cycle.blocked = true;
            if (ctx.hasUI) {
              ctx.ui.notify(`Plan validation stopped for "${check.slug}": limit reached without convergence`, "error");
            }
            await writeReceipt({
              sessionId,
              kind: "VALIDATOR_STOPPED",
              slug: check.slug,
              sha256: check.sha256,
              attempt: cycle.failedAttempts,
              issueCount: issues.length,
              issues: issues.map((i) => i.code),
              noProgressCount: cycle.noProgressCount,
            });
            return {
              block: true,
              reason: `[PLAN_VALIDATOR_STOPPED] Automatic plan validation stopped for "${check.slug}". Maximum repair attempts or no-progress limit reached (${cycle.failedAttempts} attempts, ${cycle.noProgressCount} no-progress iterations). Do not call xd://propose again; wait for user feedback or native Refine. Remaining issues:\n\n${formatRepairPacket(check.slug, issues, cycle.failedAttempts, MAX_FAILED_VALIDATIONS)}`,
            };
          }

          // 6. Remaining budget: return repair packet
          await writeReceipt({
            sessionId,
            kind: "VALIDATOR_REJECT",
            slug: check.slug,
            sha256: check.sha256,
            attempt: cycle.failedAttempts,
            issueCount: issues.length,
            issues: issues.map((i) => i.code),
          });

          return {
            block: true,
            reason: formatRepairPacket(check.slug, issues, cycle.failedAttempts, MAX_FAILED_VALIDATIONS),
          };
        }

        // 7. No structural issues: clear cycle and hand off to native OMP review
        turn.cyclesBySlug.delete(check.slug);
        void writeReceipt({ sessionId, kind: "proposal-validated", slug: check.slug, sha256: check.sha256 }).catch(() => undefined);
        return undefined;
      }

      // All other tool calls pass without touching proposal validation.
      return undefined;
    },
    async handleAgentStart(event: { prompt?: string }, ctx: ExtensionContext): Promise<void> {
      const state = stateFor(states, ctx.sessionManager.getSessionId());
      state.turnState.turnId += 1;
      state.turnState.proposalCount = 0;
      state.turnState.blocked = false;
      state.turnState.cyclesBySlug.clear();
    },
  };
}

export {
  validatePlanStructure,
  issueSignature,
  formatRepairPacket,
  PLAN_CORE_TEMPLATE,
  ENTER_PLAN_MODE_CHANNEL,
  isEnterPlanModeEventV1,
};
export type { EnterPlanModeEventV1 };

export default function planProtection(pi: ExtensionAPI): void {
  pi.setLabel("OMP Plan Kit");
  const requirements = new PlanCoreRequirementRegistry();
  const policy = createPlanProtectionForTest({
    requiresPlanCore: (sessionId) => requirements.isRequired(sessionId),
  });
  const broker = new PlanModeHookBroker(pi.events, pi.logger);
  const unsubscribePlanModeHook = pi.events.on(ENTER_PLAN_MODE_CHANNEL, (raw) => {
    if (!isEnterPlanModeEventV1(raw)) return;
    requirements.activate(raw.sessionId, raw.activationId);
    raw.addInstruction({
      id: "omp-plan-kit:format-contract",
      content: PLAN_MODE_FORMAT_CONTRACT,
    });
  });

  pi.on("before_agent_start", async (event, ctx) => {
    await policy.handleAgentStart(event, ctx);
    broker.observeLatestModeChange(ctx);
  });
  pi.on("context", (event, ctx) => broker.handleContext(event, ctx));
  pi.on("tool_call", async (event, ctx) => policy.handleToolCall(event, ctx));
  pi.on("session_shutdown", (_event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    broker.clearSession(sessionId);
    requirements.clear(sessionId);
    unsubscribePlanModeHook();
  });
}
