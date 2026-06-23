# User Access Review (UAR)

A multi-tenant compliance platform for running access-review campaigns: ingest access snapshots from connectors, assign reviewers, collect approve/revoke/exception decisions, finalize with a reproducible content-hash artifact, and export CSV evidence.

## Quick start

```bash
# 1. Start Postgres
docker compose up -d postgres

# 2. Migrate (creates all tables + uar_app RLS role)
DATABASE_URL='postgres://uar:uar_dev_password@localhost:5433/uar' \
  pnpm --filter @uar/api db:migrate

# 3. Seed a tenant (save the printed UUID)
docker exec uar-postgres psql -U uar -d uar -c \
  "INSERT INTO tenants (tenant_id, slug, name)
   VALUES (gen_random_uuid(), 'my-org', 'My Org')
   RETURNING tenant_id;"

# 4. Start the API (stub auth — no Descope project needed)
STUB_AUTHZ=true \
UAR_STUB_TENANT_ID='<tenant_uuid>'  \
UAR_STUB_USER_ID='<any_uuid>'       \
UAR_STUB_ROLES='admin'              \
DATABASE_URL='postgres://uar:uar_dev_password@localhost:5433/uar' \
UAR_INGEST_CSV='./e2e/fixtures/access.csv' \
PORT=3001 \
  pnpm --filter @uar/api dev

# 5. Start the web UI (separate terminal)
pnpm --filter @uar/web dev   # → http://localhost:3000
# If :3000 is taken: PORT=3100 pnpm --filter @uar/web dev
```

Open **http://localhost:3000**, create a campaign, trigger ingest, review items, finalize, and download the CSV evidence.

### Smoke-test the API

```bash
node -e "fetch('http://localhost:3001/health').then(r=>r.json()).then(console.log)"
# → { status: 'ok' }
```

## Repo layout

```
apps/
  api/      node:http production API server (Drizzle/Postgres, Descope auth, RLS)
  web/      Next.js 15 admin + reviewer UI
  worker/   pg-boss background worker (CSV ingest pipeline)

packages/
  core/         Zod domain contracts, review lifecycle, connector contract
  connectors/   CSV connector, GitHub connector, Descope outbound spike
  reporting/    Content-hash finalization, EvidenceSink, CSV evidence renderer
```

## Running the full test suite

```bash
# Unit tests (no Postgres needed — DB-gated tests skip cleanly)
pnpm -r test

# Unit tests against real Postgres (runs DB-gated tests)
DATABASE_URL='postgres://uar:uar_dev_password@localhost:5433/uar' pnpm -r test

# End-to-end (boots real API + web, requires Postgres on :5433)
pnpm e2e
```

> **Note:** Before running unit tests with a live Postgres, kill any running API/web dev servers first. Leftover connections can deadlock the test-reset helpers.

## Environment variables

### API (`apps/api`)

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgres://uar:uar_dev_password@localhost:5433/uar` | Postgres connection string |
| `PORT` | `3001` | HTTP listen port |
| `STUB_AUTHZ` | `false` | Bypass Descope verification (dev/e2e only; forbidden in `NODE_ENV=production`) |
| `UAR_STUB_TENANT_ID` | `local-dev-tenant` | Tenant UUID injected under stub auth |
| `UAR_STUB_USER_ID` | `local-dev-user` | User UUID injected under stub auth |
| `UAR_STUB_ROLES` | `admin` | Comma-separated roles under stub auth |
| `DESCOPE_PROJECT_ID` | _(unset)_ | Real Descope project ID; required when `STUB_AUTHZ` is not set |
| `UAR_INGEST_CSV` | `../../e2e/fixtures/access.csv` | Path to the CSV file used by the ingest endpoint |
| `UAR_INGEST_APPLICATION_ID` | _(stable UUID)_ | Application ID written to the directory graph during ingest |

> `UAR_STUB_TENANT_ID` and `UAR_STUB_USER_ID` must be valid UUIDs (the stub user acts as both admin and reviewer).

### Web (`apps/web`)

| Variable | Default | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001` | API base URL baked into the Next.js bundle at build time |

## CSV connector format

The ingest endpoint reads a CSV with these columns:

```
externalAccountId, email, displayName, grantId, accessId, accessLabel, accessType, observedAt
```

Example (`e2e/fixtures/access.csv`):

```csv
acct-001,alice@example.com,Alice Anderson,grant-001,role-admin,Production Administrator,role,2026-01-01T00:00:00.000Z
```

## Real Descope auth

1. Create a Descope project at [app.descope.com](https://app.descope.com).
2. Configure a login flow and set the session JWT to include your internal tenant UUID in the `dct` or `tenant_id` custom claim, and the user's internal UUID as the `sub`.
3. Start the API with `DESCOPE_PROJECT_ID=<your_project_id>` (drop `STUB_AUTHZ`).
4. The web app reads the `DS` session cookie set by Descope's frontend SDK and forwards it as `Authorization: Bearer` to the API.

## Architecture

See [`docs/architecture-notes.md`](docs/architecture-notes.md) for the full architecture.

Key design decisions:
- **Tenant isolation via Postgres RLS** — all 15 tenant-scoped tables have `FORCE ROW LEVEL SECURITY`; the app connects as the non-superuser `uar_app` role so policies actually enforce (migration `0005`).
- **Immutable snapshots** — a DB trigger blocks mutation of frozen snapshot nodes/edges; re-ingest creates a new snapshot.
- **Reproducible evidence** — `finalizeReviewExport` computes a deterministic SHA-256 over sorted nodes + edges + decisions + assignments; re-finalize is idempotent.
- **Connector seam** — connectors implement an `AsyncIterable<SyncResult>` interface with resumable cursors; the CSV and GitHub connectors ship today.

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm -r build

# Lint
pnpm -r lint

# Run a single package's tests
pnpm --filter @uar/api test
```

## Migrations

```bash
# Apply migrations (runs 0000–0005)
DATABASE_URL='...' pnpm --filter @uar/api db:migrate

# Generate a new migration after schema changes
pnpm --filter @uar/api db:generate
```

> Migration `0004` adds RLS policies. Migration `0005` creates the `uar_app` application role. Both must be applied before the server will start successfully.
