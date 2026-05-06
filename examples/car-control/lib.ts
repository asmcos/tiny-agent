export type CarAction = "forward" | "backward" | "turn_left" | "turn_right" | "stop";

export type CarUnit = "cm" | "deg";

export type CarCommand = {
  action: CarAction;
  value?: number;
  unit?: CarUnit;
};

export interface CarTransport {
  send(command: CarCommand): Promise<string>;
}

export function normalizeCommand(input: CarCommand): CarCommand {
  const action = input.action;
  if (action === "stop") return { action: "stop" };

  const value = input.value ?? 0;
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid value for action=${action}: ${input.value}`);
  }

  // Defaults: forward/backward use cm; turns use deg.
  const defaultUnit: CarUnit = action === "turn_left" || action === "turn_right" ? "deg" : "cm";
  const unit = input.unit ?? defaultUnit;
  return { action, value, unit };
}

export async function executeCommands(
  transport: CarTransport,
  commands: CarCommand[],
  opts?: { delayMsBetween?: number }
): Promise<string[]> {
  const delayMsBetween = opts?.delayMsBetween ?? 200;
  const out: string[] = [];

  for (const raw of commands) {
    const command = normalizeCommand(raw);
    // Keep each action atomic and ordered.
    const result = await transport.send(command);
    out.push(result);
    if (delayMsBetween > 0) {
      await new Promise((r) => setTimeout(r, delayMsBetween));
    }
  }

  return out;
}

