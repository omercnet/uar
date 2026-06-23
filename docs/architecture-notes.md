# Architecture Notes

## Status

The UAR platform MVP is **complete and deployed** on `main` (commit `0e3414b`). All 17 planned tasks built, merged, and verified end-to-end against a real browser, real API server, and real Postgres.

## Module map

```text
apps/web          Next.js 15 App Router — admin + reviewer UI
                  Routes: /campaigns (list/new/[id]/finalize), /review ([campaignId]/[itemId])
                  Auth: reads Descope DS cookie → Bearer token → API

apps/api          node:http production API server (port 3001)
                  11 endpoints + /health + CORS
                  Auth: Descope session verify → tenant resolver → authz middleware
                  DB: Drizzle ORM + postgres-js, app-role RLS enforcement
                  Ingest: runCsvIngestJob inline (no queue needed for MVP)

apps/worker       pg-boss background worker
                  Registers the CSV ingest job for queue-driven use
                  Shares runCsvIngestJob / IngestJobStore with @uar/api

packages/core     Zod domain contracts, review lifecycle state machines,
                  connector contract (AsyncIterable<SyncResult> + cursors),
                  snapshot manifest, tenant context

packages/connectors
                  CSV connector (manual-csv) — Zod boundary, resumable cursors
                  GitHub connector — org members, access_grant records, ky transport
                  Descope outbound spike — 48h contract-driven exploration

packages/reporting
                  finalizeReviewExport — deterministic SHA-256 content hash
                  EvidenceSink seam + CSV default sink
                  Drata-shaped stub sink (compiles, unused)
```

## Request lifecycle

```
Browser (DS cookie)
  → apps/web (Next.js client component)
     → fetch /campaigns/:id/... with Authorization: Bearer <jwt>
        → apps/api node:http server
           → toAuthzRequest (header adapter)
           → createAuthzMiddleware
              → verifyBearerSession (Descope SDK or STUB_AUTHZ bypass)
              → resolveTenantContext (validates UUID claims)
              → HandlerContext { tenantContext, db, req, res, params, url }
           → route handler
              → withTenantTransaction(db, tenantId, async tx => {
                   SET LOCAL ROLE uar_app           -- non-superuser, RLS enforces
                   set_config('uar.tenant_id', id, true)  -- tx-local GUC
                   ... Drizzle queries (RLS filters automatically)
                 })
```

## Tenant isolation

Every table has `ENABLE + FORCE ROW LEVEL SECURITY` with policy:
```sql
USING (tenant_id = uar_current_tenant_id())
```
where `uar_current_tenant_id() = NULLIF(current_setting('uar.tenant_id', true), '')::uuid`.

**Critical**: the app connects as the `uar_app` role (migration `0005`), which is `NOSUPERUSER NOBYPASSRLS`. The dev/CI Postgres user (`uar`) is a superuser that bypasses RLS — without the role switch, isolation silently fails. The `withTenantTransaction` helper sets both the role and the GUC tx-locally so neither leaks across pooled connections.

## Connector contract

```ts
interface Connector {
  readonly descriptor: CapabilityDescriptor;
  sync(input: { cursor: string | null }): AsyncIterable<SyncResult>;
}

type SyncResult = {
  cursor: string | null;  // null = final page; commit after consume
  records: ConnectorRecord[];
};

type ConnectorRecord = {
  recordType: 'access_grant' | 'user' | ...;
  applicationId: string;
  externalAccountId: string;
  payload: unknown;  // validated at boundary with Zod
};
```

Connectors ship in `packages/connectors`. The ingest pipeline (apps/api/src/ingest/job.ts) calls `connector.sync()`, materializes records into snapshot nodes/edges, upserts the directory graph (applications/identities/accounts/grants), generates review items, and freezes the snapshot — all in one tenant transaction.

## Evidence model

A finalized campaign produces an `EvidenceArtifact` with:
- `contentHash` — SHA-256 over canonical JSON of sorted nodes + edges + decisions + assignments. Deterministic: re-finalize returns the same hash.
- `canonicalContent` — passed to `renderCsvEvidence()` → `section,recordJson` CSV.

The snapshot freeze trigger (migration `0001`) blocks any mutation of frozen nodes/edges at the DB layer.

## Multi-tenancy checklist

- Every table has `tenant_id` (composite PK/FK).
- App connects as `uar_app` (non-superuser) so RLS enforces.
- `withTenantTransaction` sets `uar.tenant_id` GUC tx-locally — no session-level leak.
- Connector credentials encrypted via secrets envelope (AES-GCM, `@uar/api/src/secrets/`).
- Background jobs carry `TenantContext` in the pg-boss payload envelope.
- Evidence artifacts are content-addressed and immutable.

## What's not in the MVP

- Automatic deprovisioning / remediation tickets.
- PDF executive report (CSV only).
- Drata upload (stub sink compiles; wire-up is a one-liner once credentials exist).
- Full Descope login UI (server verifies JWTs when `DESCOPE_PROJECT_ID` is set; the login flow page that sets the DS cookie is a deploy-time Descope configuration step).
- Every SaaS connector (GitHub + CSV ship; Descope outbound spike is a contract-validated stub).
