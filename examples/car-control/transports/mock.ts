import type { CarCommand, CarTransport } from "../lib";

function clampFiniteNumber(n: number, label: string): number {
  if (!Number.isFinite(n)) throw new Error(`Invalid ${label}: ${n}`);
  return n;
}

export class MockCarTransport implements CarTransport {
  private xCm = 0;
  private yCm = 0;
  private headingDeg = 0; // 0 = east, 90 = north

  async send(command: CarCommand): Promise<string> {
    const { action } = command;

    if (action !== "stop") {
      const value = clampFiniteNumber(command.value ?? 0, "value");
      const unit = command.unit ?? (action.includes("turn") ? "deg" : "cm");

      if (unit === "cm") {
        const distCm = action === "backward" ? -value : value;
        const rad = (this.headingDeg * Math.PI) / 180;
        this.xCm += Math.cos(rad) * distCm;
        this.yCm += Math.sin(rad) * distCm;
      } else if (unit === "deg") {
        const delta = action === "turn_right" ? -value : value;
        this.headingDeg = (this.headingDeg + delta) % 360;
        if (this.headingDeg < 0) this.headingDeg += 360;
      } else {
        return `MOCK_ERR: Unsupported unit=${String(unit)}`;
      }
    }

    // Simulated latency so the CLI ordering feels realistic.
    await new Promise((r) => setTimeout(r, 50));

    const state = `x=${this.xCm.toFixed(2)}cm y=${this.yCm.toFixed(2)}cm heading=${this.headingDeg.toFixed(
      1
    )}deg`;
    return `MOCK_OK action=${command.action} value=${command.value ?? ""}${command.unit ? command.unit : ""} state={${state}}`;
  }
}

