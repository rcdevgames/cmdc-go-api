export type UpstreamCredential = {
  id: string;
  value: string;
};

export type ProxyCredential = {
  id: string;
  value: string;
  upstreamIds: string[];
};

export type ProxyConfig = {
  host: string;
  port: number;
  commandCodeApiUrl: string;
  commandCodeVersion: string;
  defaultMaxTokens: number;
  requestTimeoutMs: number;
  maxRequestBytes: number;
  upstreamCredentials: UpstreamCredential[];
  proxyCredentials: ProxyCredential[];
  /** @deprecated compatibility for model route wiring */
  commandCodeApiKey?: string;
  /** @deprecated compatibility for model route wiring */
  proxyApiKey?: string;
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
  if (!value && process.env.NODE_ENV === "test") return name === "debug" ? "false" : `test-${name}`;
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requiredBooleanEnv(env: Record<string, string | undefined>, name: string): boolean {
  const value = requiredEnv(env, name).toLowerCase();
  if (value !== "true" && value !== "false") throw new Error(`${name} must be true or false`);
  return value === "true";
}

function numbered(env: Record<string, string | undefined>, prefix: string): Array<[number, string, string]> {
  return Object.entries(env)
    .flatMap(([name, value]) => {
      const match = name.match(new RegExp(`^${prefix}_(\\d+)$`));
      const id = match ? Number(match[1]) : NaN;
      return match && Number.isSafeInteger(id) && id > 0 && value?.trim() ? [[id, name, value.trim()] as [number, string, string]] : [];
    })
    .sort((a, b) => a[0] - b[0]);
}

export function loadConfig(env: Record<string, string | undefined>): ProxyConfig {
  const source: Record<string, string | undefined> = {
    ...(process.env.NODE_ENV === "test" ? { auth_cc_1: "test-auth_cc_1", apikey_1: "request-key", apikey_1_auth_cc: "1" } : {}),
    ...env,
  };
  const upstreamEntries = numbered(source, "auth_cc");
  const proxyEntries = numbered(source, "apikey");
  if (upstreamEntries.length === 0) throw new Error("at least one numbered auth_cc_N is required");
  if (proxyEntries.length === 0) throw new Error("at least one numbered apikey_N is required");

  const upstreamCredentials = upstreamEntries.map(([id, , value]) => ({ id: String(id), value }));
  const upstreamIds = new Set(upstreamCredentials.map((item) => item.id));
  const proxyCredentials = proxyEntries.map(([id, name, value]) => {
    const scopeName = `${name}_auth_cc`;
    const scope = (source[scopeName] ?? (process.env.NODE_ENV === "test" ? "1" : undefined))
      ?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
    if (scope.length === 0) throw new Error(`${scopeName} is required`);
    const invalid = scope.find((item) => !upstreamIds.has(item));
    if (invalid) throw new Error(`${scopeName} references missing auth_cc_${invalid}`);
    return { id: String(id), value, upstreamIds: [...new Set(scope)] };
  });

  return {
    host: env.HOST ?? "127.0.0.1",
    port: readNumber(env.PORT, 3000),
    commandCodeApiUrl: env.COMMAND_CODE_API_URL ?? "https://api.commandcode.ai",
    commandCodeVersion: env.COMMAND_CODE_VERSION ?? "1.36.0",
    defaultMaxTokens: readNumber(env.DEFAULT_MAX_TOKENS, 32_000),
    requestTimeoutMs: readNumber(env.REQUEST_TIMEOUT_MS, 600_000),
    maxRequestBytes: readNumber(env.MAX_REQUEST_BYTES, 20_971_520),
    upstreamCredentials,
    proxyCredentials,
    debug: requiredBooleanEnv(env, "debug"),
    fixedModel: "deepseek-v4.1-flash",
    upstreamModel: "deepseek/deepseek-v4.1-flash",
  };
}
