/** a single rate-limit or usage window returned by a provider quota API */
export interface QuotaWindow {
  /** human label, e.g. "5h", "7d", "Sonnet 7d", "Credits" */
  label: string;
  /** normalized window kind for UIs that need stable grouping */
  kind?: "rolling" | "weekly" | "credits" | "other";
  /** percent of the window already consumed (0-100), null when not reported */
  usedPercent: number | null;
  /** percent remaining (0-100), null when not reported */
  remainingPercent?: number | null;
  /** iso timestamp when this window resets, null when not reported */
  resetsAt: string | null;
  /** numeric limit when the provider exposes one */
  limitValue?: number | null;
  /** numeric remaining quantity when the provider exposes one */
  remainingValue?: number | null;
  /** unit for numeric values, e.g. tokens, requests, minutes */
  unit?: string | null;
  /** free-form value label for credit-style windows, e.g. "$4.20 remaining" */
  valueLabel: string | null;
  /** optional supporting text, e.g. reset details or provider-specific notes */
  detail?: string | null;
  /** provider-specific source for this exact window */
  source?: string | null;
  /** capture timestamp for cached/manual windows */
  capturedAt?: string | null;
}

/** result for one provider from the quota-windows endpoint */
export interface ProviderQuotaResult {
  /** provider slug, e.g. "anthropic", "openai" */
  provider: string;
  /** source label when the provider reports where the quota data came from */
  source?: string | null;
  /** true when the fetch succeeded and windows is populated */
  ok: boolean;
  /** error message when ok is false */
  error?: string;
  windows: QuotaWindow[];
}

export interface CapacityWindowSnapshot {
  label: string;
  kind: "weekly" | "rolling" | "credits" | "cost" | "other";
  source: string;
  sourceLabel: string | null;
  capturedAt: string | null;
  staleDays: number | null;
  stale: boolean;
  usedPercent: number | null;
  remainingPercent: number | null;
  limitValue: number | null;
  usedValue: number | null;
  remainingValue: number | null;
  unit: string | null;
  resetsAt: string | null;
  valueLabel: string | null;
  detail: string | null;
}

export interface AgentModelCapacity {
  agentId: string;
  adapterType: string;
  provider: string;
  model: string | null;
  subscriptionId: string | null;
  cost30dCents: number;
  cost30dLabel: string;
  weekly: CapacityWindowSnapshot | null;
  rolling: CapacityWindowSnapshot | null;
  windows: CapacityWindowSnapshot[];
  manualEntryAllowed: boolean;
  narrative: string;
  updatedAt: string | null;
}
