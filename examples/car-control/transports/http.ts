import type { CarCommand, CarTransport } from "../lib";

export interface HttpCarTransportOptions {
  baseUrl: string;
  commandPath?: string; // default: /car/command
  requestTimeoutMs?: number;
}

function joinUrl(baseUrl: string, commandPath: string): string {
  const b = baseUrl.replace(/\/+$/g, "");
  const p = commandPath.startsWith("/") ? commandPath : `/${commandPath}`;
  return `${b}${p}`;
}

export class HttpCarTransport implements CarTransport {
  private readonly baseUrl: string;
  private readonly commandPath: string;
  private readonly requestTimeoutMs: number;

  constructor(opts: HttpCarTransportOptions) {
    this.baseUrl = opts.baseUrl;
    this.commandPath = opts.commandPath ?? "/car/command";
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 5000;
  }

  async send(command: CarCommand): Promise<string> {
    const url = joinUrl(this.baseUrl, this.commandPath);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(command),
        signal: controller.signal
      });

      const text = await res.text();
      if (!res.ok) {
        return `HTTP_ERR status=${res.status} body=${text}`;
      }
      return text.trim() || `HTTP_OK action=${command.action}`;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return `HTTP_ERR: ${msg}`;
    } finally {
      clearTimeout(timeout);
    }
  }
}

