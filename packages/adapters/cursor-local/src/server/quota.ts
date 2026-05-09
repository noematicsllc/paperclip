import type { ProviderQuotaResult, QuotaWindow } from "@paperclipai/adapter-utils";

const CURSOR_BILLING_SOURCE = "cursor-billing";
const CURSOR_BILLING_CACHE_MS = 15 * 60 * 1000;

let cachedQuota: { expiresAt: number; result: ProviderQuotaResult } | null = null;

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function readObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readPathNumber(root: Record<string, unknown>, path: string[]): number | null {
  let current: unknown = root;
  for (const segment of path) {
    const obj = readObject(current);
    if (!obj || !(segment in obj)) return null;
    current = obj[segment];
  }
  return readNumber(current);
}

function firstPathNumber(root: Record<string, unknown>, paths: string[][]): number | null {
  for (const path of paths) {
    const value = readPathNumber(root, path);
    if (value != null) return value;
  }
  return null;
}

function buildRequestWindow(label: string, remaining: number | null, limit: number | null): QuotaWindow | null {
  if (remaining == null && limit == null) return null;
  const normalizedRemaining = remaining != null ? Math.max(0, Math.trunc(remaining)) : null;
  const normalizedLimit = limit != null ? Math.max(0, Math.trunc(limit)) : null;
  const used =
    normalizedLimit != null && normalizedRemaining != null
      ? Math.max(0, normalizedLimit - normalizedRemaining)
      : null;
  const usedPercent =
    normalizedLimit != null && normalizedLimit > 0 && used != null
      ? Math.min(100, Math.round((used / normalizedLimit) * 100))
      : null;
  return {
    label,
    kind: "rolling",
    usedPercent,
    remainingPercent: usedPercent != null ? Math.max(0, 100 - usedPercent) : null,
    resetsAt: null,
    limitValue: normalizedLimit,
    remainingValue: normalizedRemaining,
    unit: "requests",
    valueLabel:
      normalizedRemaining != null
        ? `${normalizedRemaining.toLocaleString("en-US")} remaining`
        : (normalizedLimit != null ? `${normalizedLimit.toLocaleString("en-US")} limit` : null),
    detail:
      used != null && normalizedLimit != null
        ? `${used.toLocaleString("en-US")} used / ${normalizedLimit.toLocaleString("en-US")} limit`
        : null,
    source: CURSOR_BILLING_SOURCE,
    capturedAt: new Date().toISOString(),
  };
}

export function mapCursorBillingResponse(body: unknown): QuotaWindow[] {
  const root = readObject(body);
  if (!root) return [];

  const fastRemaining = firstPathNumber(root, [
    ["fast_remaining"],
    ["fastRemaining"],
    ["fast", "remaining"],
    ["fast_requests", "remaining"],
    ["requests", "fast", "remaining"],
    ["usage", "fast_remaining"],
    ["usage", "fastRemaining"],
  ]);
  const fastLimit = firstPathNumber(root, [
    ["fast_limit"],
    ["fastLimit"],
    ["fast", "limit"],
    ["fast_requests", "limit"],
    ["requests", "fast", "limit"],
    ["usage", "fast_limit"],
    ["usage", "fastLimit"],
  ]);
  const slowRemaining = firstPathNumber(root, [
    ["slow_remaining"],
    ["slowRemaining"],
    ["slow", "remaining"],
    ["slow_requests", "remaining"],
    ["requests", "slow", "remaining"],
    ["usage", "slow_remaining"],
    ["usage", "slowRemaining"],
  ]);
  const slowLimit = firstPathNumber(root, [
    ["slow_limit"],
    ["slowLimit"],
    ["slow", "limit"],
    ["slow_requests", "limit"],
    ["requests", "slow", "limit"],
    ["usage", "slow_limit"],
    ["usage", "slowLimit"],
  ]);

  return [
    buildRequestWindow("Fast requests", fastRemaining, fastLimit),
    buildRequestWindow("Slow requests", slowRemaining, slowLimit),
  ].filter((window): window is QuotaWindow => window != null);
}

export async function fetchCursorBillingQuota(
  apiKey: string,
  baseUrl = process.env.CURSOR_API_BASE_URL ?? "https://api.cursor.com",
): Promise<QuotaWindow[]> {
  const url = new URL("/api/billing", baseUrl);
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`cursor billing api returned ${response.status}`);
  return mapCursorBillingResponse(await response.json());
}

export async function getQuotaWindows(): Promise<ProviderQuotaResult> {
  const now = Date.now();
  if (cachedQuota && cachedQuota.expiresAt > now) return cachedQuota.result;

  const apiKey = readNonEmptyString(process.env.CURSOR_API_KEY);
  if (!apiKey) {
    const result = {
      provider: "cursor",
      source: CURSOR_BILLING_SOURCE,
      ok: false,
      error: "CURSOR_API_KEY is not set",
      windows: [],
    };
    cachedQuota = { expiresAt: now + CURSOR_BILLING_CACHE_MS, result };
    return result;
  }

  try {
    const windows = await fetchCursorBillingQuota(apiKey);
    const result = {
      provider: "cursor",
      source: CURSOR_BILLING_SOURCE,
      ok: true,
      windows,
    };
    cachedQuota = { expiresAt: now + CURSOR_BILLING_CACHE_MS, result };
    return result;
  } catch (error) {
    const result = {
      provider: "cursor",
      source: CURSOR_BILLING_SOURCE,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      windows: [],
    };
    cachedQuota = { expiresAt: now + CURSOR_BILLING_CACHE_MS, result };
    return result;
  }
}
