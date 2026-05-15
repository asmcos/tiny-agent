export class AgentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentError";
  }
}

export class AgentMaxStepsError extends AgentError {
  constructor(maxSteps: number) {
    super(`Reached max steps (${maxSteps}).`);
    this.name = "AgentMaxStepsError";
  }
}
