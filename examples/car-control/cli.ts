import { executeCommands, type CarCommand } from "./lib";
import { MockCarTransport } from "./transports/mock";
import { HttpCarTransport } from "./transports/http";

type TransportKind = "mock" | "http";

function usage(exitCode = 0): void {
  console.log(`Usage:
  npx tsx examples/car-control/cli.ts --transport mock \\
    --action forward --value 10 --unit cm

  npx tsx examples/car-control/cli.ts --transport mock \\
    --script "forward:10cm; turn_left:90deg; forward:20cm; stop"

HTTP mode:
  npx tsx examples/car-control/cli.ts --transport http \\
    --baseUrl http://localhost:8080 \\
    --action forward --value 10 --unit cm

Options:
  --transport mock|http        (default: mock)
  --baseUrl <url>             (default: http://localhost:8080)
  --commandPath </path>      (default: /car/command)
  --delayMs <number>         (default: 200)
  --action <forward|backward|turn_left|turn_right|stop>
  --value <number>
  --unit cm|deg
  --script <string>          (sequence of atomic actions)
`);
  process.exit(exitCode);
}

function getArgValue(args: string[], name: string): string | undefined {
  const i = args.findIndex((a) => a === name);
  if (i === -1) return undefined;
  return args[i + 1];
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function parseScript(script: string): CarCommand[] {
  const rawSegments = script
    .split(/[;,]/g)
    .map((s) => s.trim())
    .filter(Boolean);

  const out: CarCommand[] = [];
  for (const seg of rawSegments) {
    // Formats we accept:
    //  - "stop"
    //  - "forward 10 cm"
    //  - "forward:10cm"
    //  - "turn_left:90deg"
    const colonSplit = seg.split(":").map((s) => s.trim());
    if (colonSplit.length >= 2) {
      const action = colonSplit[0] as CarCommand["action"];
      const tail = colonSplit.slice(1).join(":");
      const m = tail.match(/^\s*([-+]?\d+(?:\.\d+)?)\s*(cm|deg)\s*$/i);
      if (m) {
        out.push({ action, value: Number(m[1]), unit: m[2].toLowerCase() as any });
      } else {
        // Fallback: number only.
        const num = Number(tail);
        if (Number.isFinite(num)) {
          out.push({ action, value: num });
        } else {
          throw new Error(`Cannot parse script segment: ${seg}`);
        }
      }
      continue;
    }

    const parts = seg.split(/\s+/g);
    const action = parts[0] as CarCommand["action"];
    if (action === "stop") {
      out.push({ action: "stop" });
      continue;
    }

    if (parts.length < 2) throw new Error(`Missing value in segment: ${seg}`);
    const value = Number(parts[1]);
    if (!Number.isFinite(value)) throw new Error(`Invalid value in segment: ${seg}`);

    const unit = parts[2] ? (parts[2].toLowerCase() as any) : undefined;
    out.push({ action, value, unit });
  }

  return out;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || hasFlag(args, "--help") || hasFlag(args, "-h")) usage(0);

  const transport = (getArgValue(args, "--transport") ?? "mock").toLowerCase() as TransportKind;
  const baseUrl = getArgValue(args, "--baseUrl") ?? "http://localhost:8080";
  const commandPath = getArgValue(args, "--commandPath") ?? "/car/command";
  const delayMsBetween = Number(getArgValue(args, "--delayMs") ?? "200");

  let commands: CarCommand[] = [];
  if (getArgValue(args, "--script")) {
    commands = parseScript(String(getArgValue(args, "--script")));
  } else {
    const actionRaw = getArgValue(args, "--action");
    if (!actionRaw) {
      usage(1);
      return;
    }
    const action = actionRaw as CarCommand["action"];
    if (action === "stop") {
      commands = [{ action: "stop" }];
    } else {
      const value = Number(getArgValue(args, "--value") ?? "0");
      if (!Number.isFinite(value)) throw new Error(`Invalid --value: ${String(getArgValue(args, "--value"))}`);
      const unit = getArgValue(args, "--unit");
      commands = [{ action, value, unit: unit ? (unit.toLowerCase() as any) : undefined }];
    }
  }

  const transportImpl =
    transport === "http"
      ? new HttpCarTransport({ baseUrl, commandPath })
      : new MockCarTransport();

  console.log(`Car control: transport=${transport} commands=${commands.length}`);
  const results = await executeCommands(transportImpl, commands, { delayMsBetween });
  for (const r of results) console.log(r);
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`ERROR: ${msg}`);
  process.exit(1);
});

