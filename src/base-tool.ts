export interface ToolParams {
  name: string;
  description: string;
  inputs: Record<string, { type: string; description: string; optional?: boolean }>;
  outputType: string;
}

export abstract class BaseTool {
  isInitialized = false;
  abstract name: string;
  abstract description: string;
  abstract inputs: Record<string, { type: string; description: string; optional?: boolean }>;
  abstract outputType: string;

  abstract setup(): Promise<void> | void;
  abstract call(args: Record<string, unknown>): Promise<string>;

  get jsonSchema(): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, spec] of Object.entries(this.inputs)) {
      properties[key] = { type: spec.type, description: spec.description };
      if (!spec.optional) required.push(key);
    }
    return { type: "object", properties, required };
  }

  protected validateArgs(args: Record<string, unknown>): void {
    for (const [key, spec] of Object.entries(this.inputs)) {
      if (spec.optional) continue;
      if (!(key in args)) throw new Error(`Missing required argument: ${key}`);
    }
  }
}

export class Tool extends BaseTool {
  name!: string;
  description!: string;
  inputs!: Record<string, { type: string; description: string; optional?: boolean }>;
  outputType!: string;
  private executeFn!: (args: Record<string, unknown>) => Promise<string>;

  constructor(params: ToolParams, execute: (args: Record<string, unknown>) => Promise<string>) {
    super();
    this.name = params.name;
    this.description = params.description;
    this.inputs = params.inputs;
    this.outputType = params.outputType;
    this.executeFn = execute;
  }

  setup(): void {
    this.isInitialized = true;
  }

  async call(args: Record<string, unknown>): Promise<string> {
    if (!this.isInitialized) await this.setup();
    this.validateArgs(args);
    return this.executeFn(args);
  }
}

export function tool(
  params: ToolParams,
  execute: (args: Record<string, unknown>) => Promise<string>
): Tool {
  return new Tool(params, execute);
}
