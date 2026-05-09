import { index, jsonb, pgTable, text, timestamp, uuid, bigint } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";

export const subscriptionCapacitySnapshot = pgTable(
  "subscription_capacity_snapshot",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    provider: text("provider").notNull(),
    subscriptionId: text("subscription_id").notNull(),
    accountLabel: text("account_label"),
    model: text("model"),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    source: text("source").notNull(),
    sourceLabel: text("source_label"),
    operatorAgentId: uuid("operator_agent_id").references(() => agents.id, { onDelete: "set null" }),
    operatorUserId: text("operator_user_id"),
    weeklyLimit: bigint("weekly_limit", { mode: "number" }),
    weeklyUsed: bigint("weekly_used", { mode: "number" }),
    weeklyRemaining: bigint("weekly_remaining", { mode: "number" }),
    rollingKind: text("rolling_kind"),
    rollingLimit: bigint("rolling_limit", { mode: "number" }),
    rollingUsed: bigint("rolling_used", { mode: "number" }),
    rollingRemaining: bigint("rolling_remaining", { mode: "number" }),
    rollingResetAt: timestamp("rolling_reset_at", { withTimezone: true }),
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyProviderCapturedIdx: index("subscription_capacity_snapshot_company_provider_captured_idx").on(
      table.companyId,
      table.provider,
      table.subscriptionId,
      table.capturedAt,
    ),
    companyAgentCapturedIdx: index("subscription_capacity_snapshot_company_agent_captured_idx").on(
      table.companyId,
      table.agentId,
      table.capturedAt,
    ),
  }),
);
