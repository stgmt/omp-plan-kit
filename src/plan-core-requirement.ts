export class PlanCoreRequirementRegistry {
  readonly #activationIds = new Map<string, string>();

  activate(sessionId: string, activationId: string): void {
    this.#activationIds.set(sessionId, activationId);
  }

  isRequired(sessionId: string): boolean {
    return this.#activationIds.has(sessionId);
  }

  clear(sessionId: string): void {
    this.#activationIds.delete(sessionId);
  }
}
