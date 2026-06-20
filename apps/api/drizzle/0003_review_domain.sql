CREATE TYPE "review_campaign_status" AS ENUM('draft', 'active', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "review_item_status" AS ENUM('pending', 'assigned', 'approved', 'revoked', 'exception', 'needs_follow_up');--> statement-breakpoint
CREATE TYPE "review_decision_action" AS ENUM('approve', 'revoke', 'exception', 'needs_follow_up');--> statement-breakpoint
CREATE TABLE "review_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" "review_campaign_status" DEFAULT 'draft' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_campaigns_tenant_id_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "review_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"access_grant_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"external_account_id" uuid NOT NULL,
	"status" "review_item_status" DEFAULT 'pending' NOT NULL,
	"decision_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_items_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "review_items_tenant_campaign_access_grant_unique" UNIQUE("tenant_id","campaign_id","access_grant_id")
);
--> statement-breakpoint
CREATE TABLE "review_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"review_item_id" uuid NOT NULL,
	"reviewer_user_id" uuid NOT NULL,
	"status" text DEFAULT 'assigned' NOT NULL,
	"assigned_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone,
	CONSTRAINT "review_assignments_tenant_id_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "review_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"review_item_id" uuid NOT NULL,
	"reviewer_user_id" uuid NOT NULL,
	"decision" "review_decision_action" NOT NULL,
	"note" text NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	CONSTRAINT "review_decisions_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "review_decisions_tenant_item_unique" UNIQUE("tenant_id","review_item_id")
);
--> statement-breakpoint
ALTER TABLE "review_campaigns" ADD CONSTRAINT "review_campaigns_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_campaigns" ADD CONSTRAINT "review_campaigns_snapshot_fk" FOREIGN KEY ("tenant_id","snapshot_id") REFERENCES "public"."snapshots"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_campaign_fk" FOREIGN KEY ("tenant_id","campaign_id") REFERENCES "public"."review_campaigns"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_snapshot_fk" FOREIGN KEY ("tenant_id","snapshot_id") REFERENCES "public"."snapshots"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_access_grant_fk" FOREIGN KEY ("tenant_id","access_grant_id") REFERENCES "public"."access_grants"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_application_fk" FOREIGN KEY ("tenant_id","application_id") REFERENCES "public"."applications"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_external_account_fk" FOREIGN KEY ("tenant_id","external_account_id") REFERENCES "public"."external_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_assignments" ADD CONSTRAINT "review_assignments_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_assignments" ADD CONSTRAINT "review_assignments_campaign_fk" FOREIGN KEY ("tenant_id","campaign_id") REFERENCES "public"."review_campaigns"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_assignments" ADD CONSTRAINT "review_assignments_item_fk" FOREIGN KEY ("tenant_id","review_item_id") REFERENCES "public"."review_items"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_assignments" ADD CONSTRAINT "review_assignments_reviewer_fk" FOREIGN KEY ("tenant_id","reviewer_user_id") REFERENCES "public"."user_identities"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_campaign_fk" FOREIGN KEY ("tenant_id","campaign_id") REFERENCES "public"."review_campaigns"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_item_fk" FOREIGN KEY ("tenant_id","review_item_id") REFERENCES "public"."review_items"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_reviewer_fk" FOREIGN KEY ("tenant_id","reviewer_user_id") REFERENCES "public"."user_identities"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_campaigns_tenant_id_idx" ON "review_campaigns" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "review_campaigns_snapshot_idx" ON "review_campaigns" USING btree ("tenant_id","snapshot_id");--> statement-breakpoint
CREATE INDEX "review_items_tenant_id_idx" ON "review_items" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "review_items_campaign_idx" ON "review_items" USING btree ("tenant_id","campaign_id");--> statement-breakpoint
CREATE INDEX "review_assignments_tenant_id_idx" ON "review_assignments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "review_assignments_item_idx" ON "review_assignments" USING btree ("tenant_id","review_item_id");--> statement-breakpoint
CREATE INDEX "review_decisions_tenant_id_idx" ON "review_decisions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "review_decisions_item_idx" ON "review_decisions" USING btree ("tenant_id","review_item_id");
