CREATE TABLE IF NOT EXISTS "subscription_capacity_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid,
	"provider" text NOT NULL,
	"subscription_id" text NOT NULL,
	"account_label" text,
	"model" text,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"source_label" text,
	"operator_agent_id" uuid,
	"operator_user_id" text,
	"weekly_limit" bigint,
	"weekly_used" bigint,
	"weekly_remaining" bigint,
	"rolling_kind" text,
	"rolling_limit" bigint,
	"rolling_used" bigint,
	"rolling_remaining" bigint,
	"rolling_reset_at" timestamp with time zone,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "subscription_capacity_snapshot" ADD CONSTRAINT "subscription_capacity_snapshot_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "subscription_capacity_snapshot" ADD CONSTRAINT "subscription_capacity_snapshot_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "subscription_capacity_snapshot" ADD CONSTRAINT "subscription_capacity_snapshot_operator_agent_id_agents_id_fk" FOREIGN KEY ("operator_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscription_capacity_snapshot_company_provider_captured_idx" ON "subscription_capacity_snapshot" USING btree ("company_id","provider","subscription_id","captured_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscription_capacity_snapshot_company_agent_captured_idx" ON "subscription_capacity_snapshot" USING btree ("company_id","agent_id","captured_at");
