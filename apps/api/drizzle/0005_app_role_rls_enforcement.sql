-- Tenant RLS only enforces for non-superuser, non-BYPASSRLS roles. The app must
-- run its queries as a dedicated `uar_app` role (the dev/CI superuser `uar`
-- bypasses RLS). Migrations keep running as the owner/superuser connection;
-- application connections set `role=uar_app` (see apps/api/src/db/client.ts).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'uar_app') THEN
    CREATE ROLE uar_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;

  IF NOT pg_has_role(current_user, 'uar_app', 'member') THEN
    EXECUTE format('GRANT uar_app TO %I', current_user);
  END IF;
END $$;
--> statement-breakpoint
ALTER ROLE uar_app WITH NOLOGIN NOSUPERUSER NOBYPASSRLS;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO uar_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO uar_app;--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO uar_app;--> statement-breakpoint
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO uar_app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE uar IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO uar_app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE uar IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO uar_app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE uar IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO uar_app;
