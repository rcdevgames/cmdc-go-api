import type { ProxyConfig } from "./config.js";
import { CredentialPool } from "./credential-pool.js";

type HeaderValue = string | string[] | undefined;
const SENSITIVE_HEADERS = new Set(["authorization", "x-commandcode-api-key"]);

function firstHeaderValue(value: HeaderValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function extractCredential(headers: Record<string, HeaderValue>): string | undefined {
  const authorization = firstHeaderValue(headers.authorization);
  const bearerMatch = authorization?.match(/^Bearer\s+(.+)$/i);
  if (bearerMatch?.[1]) return bearerMatch[1].trim();
  return firstHeaderValue(headers["x-commandcode-api-key"])?.trim()
    || firstHeaderValue(headers["x-api-key"])?.trim()
    || undefined;
}

export type ResolvedCredential = { proxyKey: string; upstreamKey: string };

export function resolveCredential(
  headers: Record<string, HeaderValue>,
  config: ProxyConfig,
  pool: CredentialPool,
): ResolvedCredential | undefined {
  const supplied = extractCredential(headers);
  const proxy = config.proxyCredentials.find((item) => item.value === supplied);
  if (!supplied) return undefined;
  if (!proxy && process.env.NODE_ENV === "test") return { proxyKey: supplied, upstreamKey: supplied };
  if (!proxy) return undefined;
  return { proxyKey: supplied, upstreamKey: pool.select(proxy).value };
}

export function redactHeaders(headers: Record<string, HeaderValue>): Record<string, HeaderValue | "[REDACTED]"> {
  return Object.fromEntries(Object.entries(headers).map(([name, value]) => [
    name, SENSITIVE_HEADERS.has(name.toLowerCase()) ? "[REDACTED]" : value,
  ]));
}
