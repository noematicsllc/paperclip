import { and, desc, eq, gte, isNull, or, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agents,
  costEvents,
  heartbeatRuns,
  subscriptionCapacitySnapshot,
} from "@paperclipai/db";
import type {
  AgentModelCapacity,
  CapacityWindowSnapshot,
  ProviderQuotaResult,
  QuotaWindow,
  RecordSubscriptionCapacitySnapshot,
} from "@paperclipai/shared";
import { fetchAllQuotaWindows } from "./quota-windows.js";

const MANUAL_STALE_AFTER_DAYS = 7;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

type AgentRow = typeof agents.$inferSelect;
type SnapshotRow = typeof subscriptionCapacitySnapshot.$inferSelect;

function readObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function providerForAdapterType(adapterType: string): string {
  if (adapterType === "claude_local") return "anthropic";
  if (adapterType === "codex_local") return "openai";
  if (adapterType === "cursor") return "cursor";
  return adapterType;
}

function modelForAgent(agent: AgentRow): string | null {
  const config = readObject(agent.adapterConfig) ?? {};
  return readString(config.model);
}

function subscriptionIdForAgent(agent: AgentRow, provider: string): string {
  const config = readObject(agent.adapterConfig) ?? {};
  const subscription = readObject(config.subscription);
  return (
    readString(config.subscriptionId) ??
    readString(subscription?.id) ??
    readString(config.accountId) ??
    `${provider}:default`
  );
}

function clampPercent(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function percentFromValues(used: number | null, limit: number | null): number | null {
  if (used == null || limit == null || limit <= 0) return null;
  return clampPercent((used / limit) * 100);
}

function staleDays(capturedAt: Date | string | null | undefined, now = new Date()): number | null {
  if (!capturedAt) return null;
  const captured = capturedAt instanceof Date ? capturedAt : new Date(capturedAt);
  if (Number.isNaN(captured.getTime())) return null;
  return Math.max(0, Math.floor((now.getTime() - captured.getTime()) / (24 * 60 * 60 * 1000)));
}

function normalizeWindow(
  window: QuotaWindow,
  source: string,
  kind: CapacityWindowSnapshot["kind"],
): CapacityWindowSnapshot {
  const usedPercent = clampPercent(window.usedPercent);
  const remainingPercent =
    clampPercent(window.remainingPercent) ??
    (usedPercent != null ? Math.max(0, 100 - usedPercent) : null);
  const capturedAt = window.capturedAt ?? new Date().toISOString();
  const days = staleDays(capturedAt);
  const resolvedSource = window.source ?? source;
  return {
    label: window.label,
    kind,
    source: resolvedSource,
    sourceLabel: resolvedSource,
    capturedAt,
    staleDays: days,
    stale: false,
    usedPercent,
    remainingPercent,
    limitValue: window.limitValue ?? null,
    usedValue:
      window.limitValue != null && window.remainingValue != null
        ? Math.max(0, window.limitValue - window.remainingValue)
        : null,
    remainingValue: window.remainingValue ?? null,
    unit: window.unit ?? null,
    resetsAt: window.resetsAt,
    valueLabel: window.valueLabel,
    detail: window.detail ?? null,
  };
}

function quotaKind(window: QuotaWindow): CapacityWindowSnapshot["kind"] {
  if (window.kind === "weekly" || window.kind === "rolling" || window.kind === "credits") return window.kind;
  const label = window.label.toLowerCase();
  if (label.includes("week") || label.includes("7d")) return "weekly";
  if (label.includes("5h") || label.includes("session") || label.includes("fast") || label.includes("slow")) {
    return "rolling";
  }
  if (label.includes("credit")) return "credits";
  return "other";
}

function pickWeekly(windows: CapacityWindowSnapshot[]): CapacityWindowSnapshot | null {
  return windows.find((window) => window.kind === "weekly") ?? null;
}

function pickRolling(provider: string, windows: CapacityWindowSnapshot[]): CapacityWindowSnapshot | null {
  const rolling = windows.filter((window) => window.kind === "rolling");
  if (provider === "cursor" && rolling.length > 1) {
    const capturedAt = rolling.map((window) => window.capturedAt).filter(Boolean).sort().at(-1) ?? null;
    return {
      label: "Fast/slow requests",
      kind: "rolling",
      source: "cursor-billing",
      sourceLabel: "cursor-billing",
      capturedAt,
      staleDays: staleDays(capturedAt),
      stale: false,
      usedPercent: null,
      remainingPercent: null,
      limitValue: null,
      usedValue: null,
      remainingValue: null,
      unit: "requests",
      resetsAt: null,
      valueLabel: rolling.map((window) => `${window.label}: ${window.valueLabel ?? "reported"}`).join(" / "),
      detail: rolling.map((window) => window.detail ?? window.valueLabel ?? window.label).join(" / "),
    };
  }
  return rolling[0] ?? null;
}

function snapshotWeekly(snapshot: SnapshotRow): CapacityWindowSnapshot | null {
  if (snapshot.weeklyLimit == null && snapshot.weeklyUsed == null && snapshot.weeklyRemaining == null) return null;
  const used =
    snapshot.weeklyUsed ??
    (snapshot.weeklyLimit != null && snapshot.weeklyRemaining != null
      ? Math.max(0, snapshot.weeklyLimit - snapshot.weeklyRemaining)
      : null);
  const usedPercent = percentFromValues(used, snapshot.weeklyLimit);
  const days = staleDays(snapshot.capturedAt);
  return {
    label: "Weekly limit",
    kind: "weekly",
    source: snapshot.source,
    sourceLabel: snapshot.sourceLabel,
    capturedAt: snapshot.capturedAt.toISOString(),
    staleDays: days,
    stale: (days ?? 0) > MANUAL_STALE_AFTER_DAYS,
    usedPercent,
    remainingPercent: usedPercent != null ? Math.max(0, 100 - usedPercent) : null,
    limitValue: snapshot.weeklyLimit,
    usedValue: used,
    remainingValue: snapshot.weeklyRemaining,
    unit: "tokens",
    resetsAt: null,
    valueLabel:
      snapshot.weeklyRemaining != null
        ? `${snapshot.weeklyRemaining.toLocaleString("en-US")} remaining`
        : null,
    detail: snapshot.sourceLabel,
  };
}

function snapshotRolling(snapshot: SnapshotRow): CapacityWindowSnapshot | null {
  if (snapshot.rollingLimit == null && snapshot.rollingUsed == null && snapshot.rollingRemaining == null) return null;
  const used =
    snapshot.rollingUsed ??
    (snapshot.rollingLimit != null && snapshot.rollingRemaining != null
      ? Math.max(0, snapshot.rollingLimit - snapshot.rollingRemaining)
      : null);
  const usedPercent = percentFromValues(used, snapshot.rollingLimit);
  const days = staleDays(snapshot.capturedAt);
  return {
    label: snapshot.rollingKind ?? "Rolling limit",
    kind: "rolling",
    source: snapshot.source,
    sourceLabel: snapshot.sourceLabel,
    capturedAt: snapshot.capturedAt.toISOString(),
    staleDays: days,
    stale: (days ?? 0) > MANUAL_STALE_AFTER_DAYS,
    usedPercent,
    remainingPercent: usedPercent != null ? Math.max(0, 100 - usedPercent) : null,
    limitValue: snapshot.rollingLimit,
    usedValue: used,
    remainingValue: snapshot.rollingRemaining,
    unit: "tokens",
    resetsAt: snapshot.rollingResetAt?.toISOString() ?? null,
    valueLabel:
      snapshot.rollingRemaining != null
        ? `${snapshot.rollingRemaining.toLocaleString("en-US")} remaining`
        : null,
    detail: snapshot.sourceLabel,
  };
}

function toIntegerOrNull(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.trunc(value);
}

function parseSnapshotDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function recordAutoCapacitySnapshot(db: Db, input: {
  agent: AgentRow;
  provider: string;
  subscriptionId: string;
  model: string | null;
  source: string;
  sourceLabel: string | null;
  weekly: CapacityWindowSnapshot | null;
  rolling: CapacityWindowSnapshot | null;
  raw: Record<string, unknown>;
}) {
  if (!input.weekly && !input.rolling) return;
  try {
    await db.insert(subscriptionCapacitySnapshot).values({
      companyId: input.agent.companyId,
      agentId: input.agent.id,
      provider: input.provider,
      subscriptionId: input.subscriptionId,
      model: input.model,
      capturedAt: new Date(),
      source: input.source,
      sourceLabel: input.sourceLabel,
      weeklyLimit: toIntegerOrNull(input.weekly?.limitValue),
      weeklyUsed: toIntegerOrNull(input.weekly?.usedValue),
      weeklyRemaining: toIntegerOrNull(input.weekly?.remainingValue),
      rollingKind: input.rolling?.label ?? null,
      rollingLimit: toIntegerOrNull(input.rolling?.limitValue),
      rollingUsed: toIntegerOrNull(input.rolling?.usedValue),
      rollingRemaining: toIntegerOrNull(input.rolling?.remainingValue),
      rollingResetAt: parseSnapshotDate(input.rolling?.resetsAt),
      raw: input.raw,
    });
  } catch {
    // Capacity display should not fail just because the audit snapshot write failed.
  }
}

const CODEX_CAP_RESET_RE =
  /(?:usage limit|usage cap)[\s\S]*?(?:try again at|cap resets at|resets at)\s+([^\n.]+?)(?:\.|\n|$)/i;

function parseCodexCapEvent(text: string | null | undefined): { resetLabel: string | null } | null {
  if (!text) return null;
  const match = text.match(CODEX_CAP_RESET_RE);
  if (!match) return null;
  return { resetLabel: match[1]?.trim() ?? null };
}

function buildNarrative(capacity: {
  provider: string;
  weekly: CapacityWindowSnapshot | null;
  rolling: CapacityWindowSnapshot | null;
  cost30dCents: number;
}) {
  const parts = [`${capacity.provider} 30d cost $${(capacity.cost30dCents / 100).toFixed(2)}`];
  if (capacity.weekly?.usedPercent != null) {
    parts.push(`weekly ${capacity.weekly.usedPercent}% used`);
  } else if (capacity.weekly?.valueLabel) {
    parts.push(`weekly ${capacity.weekly.valueLabel}`);
  } else {
    parts.push("weekly unknown");
  }
  if (capacity.rolling?.usedPercent != null) {
    parts.push(`rolling ${capacity.rolling.usedPercent}% used`);
  } else if (capacity.rolling?.valueLabel) {
    parts.push(`rolling ${capacity.rolling.valueLabel}`);
  } else {
    parts.push("rolling unknown");
  }
  return parts.join(" · ");
}

export function subscriptionCapacityService(db: Db) {
  return {
    getAgentCapacity: async (agent: AgentRow): Promise<AgentModelCapacity> => {
      const provider = providerForAdapterType(agent.adapterType);
      const model = modelForAgent(agent);
      const subscriptionId = subscriptionIdForAgent(agent, provider);
      const since = new Date(Date.now() - THIRTY_DAYS_MS);
      const costProviderCondition =
        provider === "cursor"
          ? eq(costEvents.biller, "cursor")
          : eq(costEvents.provider, provider);

      const [{ cost30dCents = 0 } = {}] = await db
        .select({
          cost30dCents: sql<number>`coalesce(sum(${costEvents.costCents}), 0)::int`,
        })
        .from(costEvents)
        .where(
          and(
            eq(costEvents.companyId, agent.companyId),
            eq(costEvents.agentId, agent.id),
            costProviderCondition,
            gte(costEvents.occurredAt, since),
            model ? eq(costEvents.model, model) : sql`true`,
          ),
        );

      const latestSnapshots = await db
        .select()
        .from(subscriptionCapacitySnapshot)
        .where(
          and(
            eq(subscriptionCapacitySnapshot.companyId, agent.companyId),
            eq(subscriptionCapacitySnapshot.provider, provider),
            eq(subscriptionCapacitySnapshot.subscriptionId, subscriptionId),
            eq(subscriptionCapacitySnapshot.source, "operator-manual-entry"),
            or(eq(subscriptionCapacitySnapshot.agentId, agent.id), isNull(subscriptionCapacitySnapshot.agentId)),
            model
              ? or(eq(subscriptionCapacitySnapshot.model, model), isNull(subscriptionCapacitySnapshot.model))
              : sql`true`,
          ),
        )
        .orderBy(desc(subscriptionCapacitySnapshot.capturedAt))
        .limit(1);
      const latestSnapshot = latestSnapshots[0] ?? null;

      let providerQuota: ProviderQuotaResult | null = null;
      try {
        providerQuota = (await fetchAllQuotaWindows()).find((result) => result.provider === provider) ?? null;
      } catch {
        providerQuota = null;
      }

      const quotaWindows = (providerQuota?.windows ?? []).map((window) =>
        normalizeWindow(window, providerQuota?.source ?? "auto-poll", quotaKind(window)),
      );
      const manualWeekly = latestSnapshot ? snapshotWeekly(latestSnapshot) : null;
      const manualRolling = latestSnapshot ? snapshotRolling(latestSnapshot) : null;
      const windows = [...quotaWindows];
      if (manualWeekly) windows.unshift(manualWeekly);
      if (manualRolling) windows.unshift(manualRolling);

      const autoWeekly = pickWeekly(quotaWindows);
      let autoRolling = pickRolling(provider, quotaWindows);
      let rolling = manualRolling ?? autoRolling;
      if (provider === "openai") {
        const [capRun] = await db
          .select({
            createdAt: heartbeatRuns.createdAt,
            error: heartbeatRuns.error,
            stderrExcerpt: heartbeatRuns.stderrExcerpt,
            stdoutExcerpt: heartbeatRuns.stdoutExcerpt,
          })
          .from(heartbeatRuns)
          .where(
            and(
              eq(heartbeatRuns.companyId, agent.companyId),
              eq(heartbeatRuns.agentId, agent.id),
              sql`(
                ${heartbeatRuns.error} ilike '%usage limit%'
                or ${heartbeatRuns.error} ilike '%usage cap%'
                or ${heartbeatRuns.stderrExcerpt} ilike '%usage limit%'
                or ${heartbeatRuns.stderrExcerpt} ilike '%usage cap%'
                or ${heartbeatRuns.stdoutExcerpt} ilike '%usage limit%'
                or ${heartbeatRuns.stdoutExcerpt} ilike '%usage cap%'
              )`,
            ),
          )
          .orderBy(desc(heartbeatRuns.createdAt))
          .limit(1);
        const cap = parseCodexCapEvent(`${capRun?.error ?? ""}\n${capRun?.stderrExcerpt ?? ""}\n${capRun?.stdoutExcerpt ?? ""}`);
        if (capRun && cap) {
          rolling = {
            label: "5h rolling cap event",
            kind: "rolling",
            source: "codex-cap-event",
            sourceLabel: "latest cap-hit run",
            capturedAt: capRun.createdAt.toISOString(),
            staleDays: staleDays(capRun.createdAt),
            stale: false,
            usedPercent: 100,
            remainingPercent: 0,
            limitValue: null,
            usedValue: null,
            remainingValue: 0,
            unit: "requests",
            resetsAt: null,
            valueLabel: "0 remaining",
            detail: cap.resetLabel ? `Resets at ${cap.resetLabel}` : "Usage cap observed",
          };
          autoRolling = rolling;
          windows.unshift(rolling);
        }
      }

      const weekly = manualWeekly ?? autoWeekly;
      await recordAutoCapacitySnapshot(db, {
        agent,
        provider,
        subscriptionId,
        model,
        source: autoRolling?.source ?? autoWeekly?.source ?? providerQuota?.source ?? "auto-poll",
        sourceLabel: autoRolling?.sourceLabel ?? autoWeekly?.sourceLabel ?? providerQuota?.source ?? "auto-poll",
        weekly: autoWeekly,
        rolling: autoRolling,
        raw: {
          providerQuota,
          weekly: autoWeekly,
          rolling: autoRolling,
        },
      });

      const result = {
        agentId: agent.id,
        adapterType: agent.adapterType,
        provider,
        model,
        subscriptionId,
        cost30dCents: Number(cost30dCents) || 0,
        cost30dLabel: `$${((Number(cost30dCents) || 0) / 100).toFixed(2)}`,
        weekly,
        rolling,
        windows,
        manualEntryAllowed: provider === "anthropic" || provider === "openai",
        updatedAt: new Date().toISOString(),
        narrative: "",
      };
      return {
        ...result,
        narrative: buildNarrative(result),
      };
    },

    recordManualSnapshot: async (
      agent: AgentRow,
      input: RecordSubscriptionCapacitySnapshot,
      actor: { agentId?: string | null; userId?: string | null },
    ) => {
      const provider = providerForAdapterType(agent.adapterType);
      const model = modelForAgent(agent);
      const subscriptionId = subscriptionIdForAgent(agent, provider);
      const capturedAt = input.capturedAt ? new Date(input.capturedAt) : new Date();
      const rollingResetAt = input.rollingResetAt ? new Date(input.rollingResetAt) : null;
      const [row] = await db
        .insert(subscriptionCapacitySnapshot)
        .values({
          companyId: agent.companyId,
          agentId: agent.id,
          provider,
          subscriptionId,
          model,
          capturedAt,
          source: "operator-manual-entry",
          sourceLabel: input.sourceLabel,
          operatorAgentId: actor.agentId ?? null,
          operatorUserId: actor.userId ?? null,
          weeklyLimit: input.weeklyLimit ?? null,
          weeklyUsed: input.weeklyUsed ?? null,
          weeklyRemaining: input.weeklyRemaining ?? null,
          rollingKind: input.rollingKind ?? null,
          rollingLimit: input.rollingLimit ?? null,
          rollingUsed: input.rollingUsed ?? null,
          rollingRemaining: input.rollingRemaining ?? null,
          rollingResetAt,
          raw: input,
        })
        .returning();
      return row;
    },
  };
}
