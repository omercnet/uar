CREATE TYPE "snapshot_lifecycle" AS ENUM ('building', 'ready', 'frozen');
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connector_id" text NOT NULL,
	"ingestion_run_id" uuid,
	"lifecycle" "snapshot_lifecycle" DEFAULT 'building' NOT NULL,
	"manifest" jsonb NOT NULL,
	"manifest_hash" text,
	"ready_at" timestamp with time zone,
	"frozen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "snapshots_tenant_id_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "snapshot_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"node_type" text NOT NULL,
	"stable_id" text NOT NULL,
	"label" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "snapshot_nodes_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "snapshot_nodes_tenant_snapshot_id_id_unique" UNIQUE("tenant_id","snapshot_id","id"),
	CONSTRAINT "snapshot_nodes_tenant_snapshot_stable_unique" UNIQUE("tenant_id","snapshot_id","node_type","stable_id")
);
--> statement-breakpoint
CREATE TABLE "snapshot_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"source_node_id" uuid NOT NULL,
	"target_node_id" uuid NOT NULL,
	"edge_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "snapshot_edges_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "snapshot_edges_tenant_snapshot_edge_unique" UNIQUE("tenant_id","snapshot_id","source_node_id","target_node_id","edge_type")
);
--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_ingestion_run_fk" FOREIGN KEY ("tenant_id","ingestion_run_id") REFERENCES "public"."ingestion_runs"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "snapshot_nodes" ADD CONSTRAINT "snapshot_nodes_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "snapshot_nodes" ADD CONSTRAINT "snapshot_nodes_snapshot_fk" FOREIGN KEY ("tenant_id","snapshot_id") REFERENCES "public"."snapshots"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "snapshot_edges" ADD CONSTRAINT "snapshot_edges_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "snapshot_edges" ADD CONSTRAINT "snapshot_edges_snapshot_fk" FOREIGN KEY ("tenant_id","snapshot_id") REFERENCES "public"."snapshots"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "snapshot_edges" ADD CONSTRAINT "snapshot_edges_source_node_fk" FOREIGN KEY ("tenant_id","snapshot_id","source_node_id") REFERENCES "public"."snapshot_nodes"("tenant_id","snapshot_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "snapshot_edges" ADD CONSTRAINT "snapshot_edges_target_node_fk" FOREIGN KEY ("tenant_id","snapshot_id","target_node_id") REFERENCES "public"."snapshot_nodes"("tenant_id","snapshot_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "snapshots_tenant_id_idx" ON "snapshots" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX "snapshots_tenant_connector_idx" ON "snapshots" USING btree ("tenant_id","connector_id");
--> statement-breakpoint
CREATE INDEX "snapshot_nodes_tenant_id_idx" ON "snapshot_nodes" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX "snapshot_nodes_snapshot_id_idx" ON "snapshot_nodes" USING btree ("tenant_id","snapshot_id");
--> statement-breakpoint
CREATE INDEX "snapshot_edges_tenant_id_idx" ON "snapshot_edges" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX "snapshot_edges_snapshot_id_idx" ON "snapshot_edges" USING btree ("tenant_id","snapshot_id");
--> statement-breakpoint
CREATE FUNCTION enforce_snapshot_lifecycle_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.lifecycle <> 'building' THEN
      RAISE EXCEPTION 'snapshot lifecycle must start at building, got %', NEW.lifecycle
        USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
  END IF;

  IF OLD.lifecycle = 'frozen' THEN
    RAISE EXCEPTION 'frozen snapshot % is immutable', OLD.id
      USING ERRCODE = '23514';
  END IF;

  IF NEW.lifecycle = OLD.lifecycle THEN
    RETURN NEW;
  END IF;

  IF OLD.lifecycle = 'building' AND NEW.lifecycle = 'ready' THEN
    NEW.ready_at = COALESCE(NEW.ready_at, now());
    RETURN NEW;
  END IF;

  IF OLD.lifecycle = 'ready' AND NEW.lifecycle = 'frozen' THEN
    IF NEW.manifest_hash IS NULL OR NEW.manifest_hash !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'frozen snapshot % requires a SHA-256 manifest hash', NEW.id
        USING ERRCODE = '23514';
    END IF;

    NEW.ready_at = COALESCE(NEW.ready_at, OLD.ready_at, now());
    NEW.frozen_at = COALESCE(NEW.frozen_at, now());
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'invalid snapshot lifecycle transition: % to %', OLD.lifecycle, NEW.lifecycle
    USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER snapshots_lifecycle_guard
BEFORE INSERT OR UPDATE ON "snapshots"
FOR EACH ROW
EXECUTE FUNCTION enforce_snapshot_lifecycle_transition();
--> statement-breakpoint
CREATE FUNCTION reject_frozen_snapshot_record_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_lifecycle snapshot_lifecycle;
  new_lifecycle snapshot_lifecycle;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT lifecycle
    INTO old_lifecycle
    FROM snapshots
    WHERE tenant_id = OLD.tenant_id
      AND id = OLD.snapshot_id;

    IF old_lifecycle = 'frozen' THEN
      RAISE EXCEPTION 'frozen snapshot % is immutable', OLD.snapshot_id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT lifecycle
    INTO new_lifecycle
    FROM snapshots
    WHERE tenant_id = NEW.tenant_id
      AND id = NEW.snapshot_id;

    IF new_lifecycle = 'frozen' THEN
      RAISE EXCEPTION 'frozen snapshot % is immutable', NEW.snapshot_id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER snapshot_nodes_freeze_guard
BEFORE INSERT OR UPDATE OR DELETE ON "snapshot_nodes"
FOR EACH ROW
EXECUTE FUNCTION reject_frozen_snapshot_record_mutation();
--> statement-breakpoint
CREATE TRIGGER snapshot_edges_freeze_guard
BEFORE INSERT OR UPDATE OR DELETE ON "snapshot_edges"
FOR EACH ROW
EXECUTE FUNCTION reject_frozen_snapshot_record_mutation();
