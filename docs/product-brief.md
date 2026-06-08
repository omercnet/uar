# User Access Review Product Brief

## Working goal

Build a pluggable User Access Review (UAR) platform for compliance evidence collection. Start as an internal compliance tool, but design the architecture so it can become an open source multi-tenant SaaS later.

## Primary users

- Compliance/admin operators who configure review campaigns and evidence exports.
- Application/system owners who review access.
- Managers/reviewers who approve or revoke individual users' access.
- Auditors who consume CSV/PDF evidence reports and Drata-uploaded evidence.

## Core requirements from kickoff

1. Scope must be pluggable: eventually everything should be reviewable.
2. Must produce CSV and PDF reports for auditors.
3. Must integrate with Drata to upload evidence.
4. Must provide a web app for admins/reviewers to review and approve access.
5. Must model users, systems/apps, accounts, roles/permissions, owners/managers, review cycles, decisions, and evidence.
6. Must support ingestion, identity normalization, reviewer assignment, approval/revocation decisions, audit evidence generation, and optional remediation/tickets.
7. Must use Descope for authentication.
8. Must use Descope Outbound Apps to connect to and review third-party applications.
9. Should be multi-tenant-capable from the beginning.

## Product shape

The product is a compliance workflow system with three layers:

1. Connector layer
   - Pluggable integrations that discover users, accounts, groups, roles, permissions, and metadata from external systems.
   - Descope Outbound Apps should be the preferred OAuth/connection mechanism for third-party SaaS integrations.

2. Review workflow layer
   - Normalizes connector data into a common access graph.
   - Creates review campaigns.
   - Assigns reviewers.
   - Tracks decisions: approve, revoke, exception, needs follow-up.
   - Maintains immutable evidence snapshots.

3. Evidence/remediation layer
   - Generates CSV/PDF reports.
   - Uploads evidence to Drata.
   - Optionally creates remediation tickets or triggers deprovisioning workflows.

## Initial architecture principles

- Multi-tenant from day one: every persisted object must be tenant-scoped.
- Plugin contracts before many plugins: build one or two connectors first, but define the connector interface clearly.
- Evidence is immutable: review exports should be reproducible even if source app access changes later.
- Separation of ingestion and review: imported access snapshots should not mutate active campaigns silently.
- Human approval first, automated remediation second.
- Open-source-friendly: avoid hard dependencies on proprietary internal infrastructure beyond configurable providers.

## Suggested MVP

### MVP connectors

1. Descope tenant/application data, using Descope APIs and Outbound Apps where applicable.
2. Google Workspace or GitHub as the first generic SaaS connector.
3. Manual CSV upload connector as an escape hatch for unsupported apps.

### MVP workflow

- Admin creates a review campaign.
- Admin selects connected apps/systems in scope.
- System ingests access snapshots.
- System suggests reviewers from manager/app owner metadata.
- Reviewers approve/revoke/mark exception.
- Admin finalizes campaign.
- System exports CSV/PDF evidence.
- System uploads evidence to Drata.

### MVP non-goals

- Fully automatic deprovisioning.
- Every SaaS connector.
- Complex role mining or access recommendations.
- Public SaaS billing/self-serve onboarding.

## Domain model draft

- Tenant
- UserIdentity
- ExternalAccount
- Application/System
- ConnectorInstallation
- AccessGrant
- Role/Permission
- ReviewCampaign
- ReviewItem
- ReviewAssignment
- ReviewDecision
- EvidenceArtifact
- DrataUpload
- AuditLogEvent

## Open questions

1. First target tenant: Descope internal only, or multiple internal business units?
2. First connector after Descope: Google Workspace, GitHub, AWS IAM, Slack, Okta, or manual CSV?
3. Should remediation initially be manual instructions, ticket creation, or API-driven revoke?
4. Which Drata evidence objects/controls should we target first?
5. Do we want a monorepo with web/API/workers/packages, or start smaller?
6. Preferred stack: TypeScript/Next.js/Postgres, Python/FastAPI, or something else?
