-- Tenant RLS only enforces for non-superuser, non-BYPASSRLS roles.
-- On local dev the connecting user is a superuser (bypasses RLS), so we
-- create a dedicated uar_app role and SET ROLE to it per-transaction.
-- On Aurora (Vercel IAM auth) the IAM user is already a non-superuser,
-- so RLS enforces automatically — uar_app creation is skipped gracefully.
DO $$
BEGIN
  -- Create the role if we have CREATEROLE privilege; skip silently otherwise.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'uar_app') THEN
    BEGIN
      CREATE ROLE uar_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'uar_app role creation skipped (insufficient privilege — Aurora IAM path)';
    END;
  END IF;

  -- Grant membership so the app can SET ROLE uar_app locally.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'uar_app')
     AND NOT pg_has_role(current_user, 'uar_app', 'member') THEN
    BEGIN
      EXECUTE format('GRANT uar_app TO %I', current_user);
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'GRANT uar_app skipped (insufficient privilege)';
    END;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'uar_app') THEN
    EXECUTE 'ALTER ROLE uar_app WITH NOLOGIN NOSUPERUSER NOBYPASSRLS';
    EXECUTE 'GRANT USAGE ON SCHEMA public TO uar_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO uar_app';
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO uar_app';
    EXECUTE 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO uar_app';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO uar_app';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO uar_app';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO uar_app';
  END IF;
END $$;
