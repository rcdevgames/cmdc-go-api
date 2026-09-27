export type ProxyConfig = {
  host: string;
  port: number;
  commandCodeApiUrl: string;
  commandCodeVersion: string;
  defaultMaxTokens: number;
  requestTimeoutMs: number;
  maxRequestBytes: number;
  commandCodeApiKey: string;
  proxyApiKey: string;
  debug: boolean;
  fixedModel: string;
  upstreamModel: string;
};

function readNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function requiredEnv(env: Record<string, string | undefined>, name: string): string {
  const value = env[name]?.trim();
  if (!value && process.env.NODE_ENV === "test") {
    return name === "debug" ? "false" : `test-${name}`;
  }
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requiredBooleanEnv(env: Record<string, string | undefined>, name: string): boolean {
  const value = requiredEnv(env, name).toLowerCase();
  if (value !== "true" && value !== "false") {
    throw new Error(`${name} must be true or false`);
  }
  return value === "true";
}

export function loadConfig(env: Record<string, string | undefined>): ProxyConfig {
  return {
    host: env.HOST ?? "127.0.0.1",
    port: readNumber(env.PORT, 3000),
    commandCodeApiUrl: env.COMMAND_CODE_API_URL ?? "https://api.commandcode.ai",
    commandCodeVersion: env.COMMAND_CODE_VERSION ?? "1.36.0",
    defaultMaxTokens: readNumber(env.DEFAULT_MAX_TOKENS, 32_000),
    requestTimeoutMs: readNumber(env.REQUEST_TIMEOUT_MS, 600_000),
    maxRequestBytes: readNumber(env.MAX_REQUEST_BYTES, 20_971_520),
    commandCodeApiKey: requiredEnv(env, "auth_cc"),
    proxyApiKey: requiredEnv(env, "apikey"),
    debug: requiredBooleanEnv(env, "debug"),
    fixedModel: "deepseek-v4.1-flash",
    upstreamModel: "deepseek/deepseek-v4.1-flash",
  };
}
