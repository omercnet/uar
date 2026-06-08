# Architecture Notes

## High-level modules

```text
apps/web
  Admin and reviewer web app.

apps/api
  Backend API for campaigns, reviews, connector management, reporting, and Drata uploads.

apps/worker
  Background jobs for connector syncs, report rendering, scheduled campaigns, and evidence upload retries.

packages/core
  Shared domain types, validation schemas, access graph model, and connector contract.

packages/connectors
  Built-in connectors: Descope, manual CSV, and the first SaaS integrations.

packages/reporting
  CSV/PDF generation and evidence package creation.
```

## Connector contract draft

Each connector should expose capabilities instead of assuming every app has the same model.

```ts
type ConnectorCapability =
  | "users"
  | "groups"
  | "roles"
  | "permissions"
  | "access_grants"
  | "owners"
  | "revoke"
  | "evidence_links";

type Connector = {
  id: string;
  name: string;
  capabilities: ConnectorCapability[];
  configure(input: ConnectorConfigInput): Promise<ConnectorInstallation>;
  testConnection(installation: ConnectorInstallation): Promise<ConnectionHealth>;
  sync(snapshotContext: SnapshotContext): AsyncIterable<ConnectorRecord>;
  revoke?(request: RevokeAccessRequest): Promise<RemediationResult>;
};
```

## Multi-tenancy baseline

- Every table includes `tenant_id`.
- Auth sessions map Descope identities to tenant memberships and roles.
- Connector credentials are tenant-scoped and encrypted.
- Background jobs always carry tenant context.
- Evidence artifacts are tenant-scoped, content-addressed, and immutable.

## Evidence model

A finalized review campaign should create an evidence package containing:

- Access snapshot used for review.
- Reviewer assignments.
- Decisions and timestamps.
- Exceptions and notes.
- CSV export.
- PDF executive/auditor report.
- Drata upload status and external evidence IDs.

## First implementation recommendation

Use TypeScript for the whole system unless there is a strong reason not to:

- Next.js web app for admin/reviewer UX.
- Node/TypeScript API and worker.
- Postgres for relational data.
- Drizzle or Prisma for schema/migrations.
- Zod for shared validation schemas.
- Playwright for end-to-end review flows.

This fits Descope web auth, Descope Outbound Apps, SaaS connector SDKs, and open-source SaaS packaging well.
