import type {
  ContextEvent,
  ContextEventResult,
  ExtensionAPI,
  ExtensionContext,
} from "@oh-my-pi/pi-coding-agent";

export const ENTER_PLAN_MODE_CHANNEL = "omp-plan-kit:enter-plan-mode";
export const PLAN_MODE_CONTEXT_TYPE = "plan-mode-context";
export const PLAN_MODE_INSTRUCTION_TYPE = "omp-plan-kit:plan-mode-instruction";

export interface PlanModeInstruction {
  id: string;
  content: string;
}

export interface EnterPlanModeEventV1 {
  apiVersion: 1;
  sessionId: string;
  activationId: string;
  planFilePath?: string;
  addInstruction(input: PlanModeInstruction): void;
}

export function isEnterPlanModeEventV1(value: unknown): value is EnterPlanModeEventV1 {
  if (!isRecord(value)) return false;
  return value.apiVersion === 1
    && isNonEmptyString(value.sessionId)
    && isNonEmptyString(value.activationId)
    && (value.planFilePath === undefined || typeof value.planFilePath === "string")
    && typeof value.addInstruction === "function";
}

type AgentMessage = ContextEvent["messages"][number];
type HookLogger = Pick<ExtensionAPI["logger"], "warn">;

type ModeChangeSnapshot = {
  id: string;
  mode: string;
  planFilePath?: string;
};

type ActivationState = {
  activationId: string;
  journalId?: string;
  planFilePath?: string;
  instructions: PlanModeInstruction[];
};

type SessionHookState = {
  latestModeChange?: ModeChangeSnapshot;
  active?: ActivationState;
  nextObservationId: number;
};

type BranchReader = {
  getBranch?: () => unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPlanModeContextMessage(message: unknown): boolean {
  return isRecord(message)
    && message.role === "custom"
    && message.customType === PLAN_MODE_CONTEXT_TYPE;
}

function isPlanModeInstructionMessage(message: unknown): boolean {
  return isRecord(message)
    && message.role === "custom"
    && message.customType === PLAN_MODE_INSTRUCTION_TYPE;
}

function latestModeChange(ctx: ExtensionContext): ModeChangeSnapshot | null | undefined {
  const getBranch = (ctx.sessionManager as BranchReader).getBranch;
  if (typeof getBranch !== "function") return undefined;

  let branch: unknown;
  try {
    branch = getBranch.call(ctx.sessionManager);
  } catch {
    return undefined;
  }
  if (!Array.isArray(branch)) return undefined;

  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (!isRecord(entry) || entry.type !== "mode_change" || !isNonEmptyString(entry.id) || typeof entry.mode !== "string") {
      continue;
    }
    const data = isRecord(entry.data) ? entry.data : undefined;
    const planFilePath = isNonEmptyString(data?.planFilePath) ? data.planFilePath : undefined;
    return { id: entry.id, mode: entry.mode, planFilePath };
  }
  return null;
}

export class PlanModeHookBroker {
  readonly #states = new Map<string, SessionHookState>();
  readonly #events: ExtensionAPI["events"];
  readonly #logger?: HookLogger;

  constructor(events: ExtensionAPI["events"], logger?: HookLogger) {
    this.#events = events;
    this.#logger = logger;
  }

  observeLatestModeChange(ctx: ExtensionContext): ModeChangeSnapshot | undefined {
    const state = this.#stateFor(ctx.sessionManager.getSessionId());
    const observed = latestModeChange(ctx);
    if (observed !== undefined) state.latestModeChange = observed ?? undefined;
    return state.latestModeChange;
  }

  handleContext(event: ContextEvent, ctx: ExtensionContext): ContextEventResult | undefined {
    const sessionId = ctx.sessionManager.getSessionId();
    const state = this.#stateFor(sessionId);
    this.observeLatestModeChange(ctx);

    const markerIndex = event.messages.findIndex(isPlanModeContextMessage);
    if (markerIndex < 0) {
      state.active = undefined;
      return undefined;
    }

    const journalPlan = state.latestModeChange?.mode === "plan" ? state.latestModeChange : undefined;
    let activation = state.active;
    if (!activation) {
      activation = this.#startActivation(sessionId, state, journalPlan);
    } else if (journalPlan && !activation.journalId) {
      activation.journalId = journalPlan.id;
      activation.planFilePath ??= journalPlan.planFilePath;
    } else if (journalPlan && activation.journalId !== journalPlan.id) {
      activation = this.#startActivation(sessionId, state, journalPlan);
    }

    const messagesWithoutPriorInstructions = event.messages.filter(
      (message) => !isPlanModeInstructionMessage(message),
    );
    const currentMarkerIndex = messagesWithoutPriorInstructions.findIndex(isPlanModeContextMessage);
    const injected = activation.instructions.map((instruction): AgentMessage => ({
      role: "custom",
      customType: PLAN_MODE_INSTRUCTION_TYPE,
      content: instruction.content,
      display: false,
      attribution: "agent",
      details: { apiVersion: 1, id: instruction.id },
      timestamp: Date.now(),
    } as AgentMessage));

    return {
      messages: [
        ...messagesWithoutPriorInstructions.slice(0, currentMarkerIndex + 1),
        ...injected,
        ...messagesWithoutPriorInstructions.slice(currentMarkerIndex + 1),
      ],
    };
  }

  clearSession(sessionId: string): void {
    this.#states.delete(sessionId);
  }

  #stateFor(sessionId: string): SessionHookState {
    const existing = this.#states.get(sessionId);
    if (existing) return existing;
    const created: SessionHookState = { nextObservationId: 0 };
    this.#states.set(sessionId, created);
    return created;
  }

  #startActivation(
    sessionId: string,
    state: SessionHookState,
    journalPlan?: ModeChangeSnapshot,
  ): ActivationState {
    const activationId = journalPlan?.id ?? `observation:${++state.nextObservationId}`;
    const instructions = new Map<string, PlanModeInstruction>();
    let collecting = true;
    const event: EnterPlanModeEventV1 = {
      apiVersion: 1,
      sessionId,
      activationId,
      ...(journalPlan?.planFilePath ? { planFilePath: journalPlan.planFilePath } : {}),
      addInstruction: (input) => {
        if (!collecting) {
          this.#logger?.warn("Rejected late plan-mode instruction", { sessionId, activationId });
          return;
        }
        if (!isRecord(input) || !isNonEmptyString(input.id) || !isNonEmptyString(input.content)) {
          this.#logger?.warn("Rejected invalid plan-mode instruction", { sessionId, activationId });
          return;
        }
        const id = input.id.trim();
        if (instructions.has(id)) return;
        instructions.set(id, { id, content: input.content });
      },
    };

    const activation: ActivationState = {
      activationId,
      journalId: journalPlan?.id,
      planFilePath: journalPlan?.planFilePath,
      instructions: [],
    };
    state.active = activation;
    try {
      this.#events.emit(ENTER_PLAN_MODE_CHANNEL, event);
    } finally {
      collecting = false;
      activation.instructions = [...instructions.values()];
    }
    return activation;
  }
}
