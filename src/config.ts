import fs from "node:fs";
import path from "node:path";
import type { AppConfig } from "./types";

const DEFAULT_CONFIG_PATH = path.resolve(process.cwd(), "config.json");

function resolveConfigPath(explicitPath?: string): string {
  if (explicitPath != null && explicitPath !== "") {
    return path.isAbsolute(explicitPath) ? explicitPath : path.resolve(process.cwd(), explicitPath);
  }
  if (process.env.TINY_AGENT_CONFIG != null && process.env.TINY_AGENT_CONFIG !== "") {
    return path.resolve(process.cwd(), process.env.TINY_AGENT_CONFIG);
  }
  return DEFAULT_CONFIG_PATH;
}

export function loadConfig(explicitPath?: string): AppConfig {
  const configPath = resolveConfigPath(explicitPath);
  if (!fs.existsSync(configPath)) {
    throw new Error(`Missing config file: ${configPath}`);
  }
  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = JSON.parse(raw) as AppConfig;
  validateConfig(parsed);
  return parsed;
}

/** Same as `loadConfig` but returns `undefined` if the file is missing (no throw). */
export function tryLoadConfig(explicitPath?: string): AppConfig | undefined {
  const configPath = resolveConfigPath(explicitPath);
  if (!fs.existsSync(configPath)) {
    return undefined;
  }
  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = JSON.parse(raw) as AppConfig;
  validateConfig(parsed);
  return parsed;
}

function validateConfig(config: AppConfig): void {
  if (!config.providers) {
    throw new Error("config.providers is required");
  }
  if (!config.providers.ollama || !config.providers.deepseek) {
    throw new Error("config.providers.ollama and config.providers.deepseek are required");
  }
  if (!config.providers.ollama.model) {
    throw new Error("config.providers.ollama.model is required");
  }
  if (!config.providers.deepseek.model) {
    throw new Error("config.providers.deepseek.model is required");
  }
  if (!config.providers.deepseek.apiKey) {
    throw new Error("config.providers.deepseek.apiKey is required");
  }
  if (!config.runtime) {
    throw new Error("config.runtime is required");
  }
}
