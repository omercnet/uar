# UAR Production API Specification
## Source: e2e/harness/server.ts (464 lines)

---

## 1. CORS CONFIGURATION

**File**: e2e/harness/server.ts, lines 74-78

```typescript
const CORS_HEADERS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
};
```

**Implementation**:
- All responses include CORS headers (line 128)
- OPTIONS requests return 204 with CORS headers (line 350-354)
- No auth token validation in harness (single-tenant, in-memory)

---

## 2. AUTHENTICATION & TENANT HANDLING

**Single-Tenant Constants** (lines 64-69):
```typescript
const TENANT_ID = 'tenant-e2e';
const REVIEWER_USER_ID = 'reviewer-e2e';
const APPLICATION_ID = 'app-e2e-okta';
const FIXED_OBSERVED_AT = '2026-01-01T00:00:00.000Z';
const FIXED_ASSIGNED_AT = '2026-01-10T00:00:00.000Z';
const FIXED_DECIDED_AT = '2026-01-15T00:00:00.000Z';
```

**Auth Flow**:
- No token parsing in harness (hardcoded TENANT_ID, REVIEWER_USER_ID)
- Production server MUST:
  - Parse Authorization header (Bearer token)
  - Extract tenant_id from token claims
  - Extract user_id from token claims
  - Validate token via Descope

---

## 3. REQUEST BODY SCHEMAS

### CreateCampaignBody (lines 98-103)
```typescript
const CreateCampaignBody = z.object({
  name: z.string().min(1),
  snapshotId: z.string().min(1),
  startsAt: z.string().min(1),
  dueAt: z.string().min(1),
});
```

### UpdateStatusBody (lines 105-107)
```typescript
const UpdateStatusBody = z.object({
  status: z.enum(['draft', 'active', 'completed', 'cancelled']),
});
```

### DecideBody (lines 109-112)
```typescript
const DecideBody = z.object({
  decision: z.enum(['approve', 'revoke', 'exception', 'needs_follow_up']),
  note: z.string(),
});
```

---

## 4. COMPLETE ROUTE SPECIFICATION

### 4.1 Health Check
**Route**: `GET /health`  
**Handler**: line 356-359  
**Response**: 
```json
{ "status": "ok" }
```
**Status**: 200

---

### 4.2 Campaign Management

#### 4.2.1 List All Campaigns
**Route**: `GET /campaigns`  
**Handler**: line 365-368  
**Response**: `ReviewCampaign[]` (200)  
**Implementation**:
```typescript
[...campaigns.values()].map((state) => state.campaign)
```

#### 4.2.2 Create Campaign
**Route**: `POST /campaigns`  
**Handler**: line 169-192 (createCampaign function)  
**Request Body**: CreateCampaignBody  
**Response**: `ReviewCampaign` (201)  
**Domain Functions Called**:
- `ReviewCampaignSchema.parse()` (line 172)
- `assertReviewCampaignSnapshotFrozen('frozen')` (line 177)

**Implementation Details** (lines 169-192):
```typescript
function createCampaign(raw: string): ReviewCampaign {
  const body = parseJsonBody(raw, CreateCampaignBody);
  const campaignId = `campaign-${body.snapshotId}`;
  const campaign = ReviewCampaignSchema.parse({
    tenantId: TENANT_ID,
    campaignId,
    name: body.name,
    snapshotId: body.snapshotId,
    snapshotLifecycle: assertReviewCampaignSnapshotFrozen('frozen'),
    status: 'draft',
    startsAt: new Date(body.startsAt).toISOString(),
    dueAt: new Date(body.dueAt).toISOString(),
    createdAt: new Date().toISOString(),
  });
  campaigns.set(campaignId, {
    campaign,
    items: [],
    decisions: [],
    assignments: [],
    nodes: [],
    edges: [],
  });
  return campaign;
}
```

**Campaign ID Generation**: `campaign-${snapshotId}` (line 171)

#### 4.2.3 Get Campaign Details
**Route**: `GET /campaigns/:campaignId`  
**Handler**: line 376-379  
**Response**: `ReviewCampaign` (200)  
**Error**: 404 if campaign not found (line 157)

#### 4.2.4 Update Campaign Status
**Route**: `PATCH /campaigns/:campaignId/status`  
**Handler**: line 194-200 (updateStatus function)  
**Request Body**: UpdateStatusBody  
**Response**: `ReviewCampaign` (200)  
**Domain Functions Called**:
- `assertReviewCampaignTransition(currentStatus, newStatus)` (line 197)

**Implementation** (lines 194-200):
```typescript
function updateStatus(campaignId: string, raw: string): ReviewCampaign {
  const state = requireCampaign(campaignId);
  const body = parseJsonBody(raw, UpdateStatusBody);
  assertReviewCampaignTransition(state.campaign.status, body.status);
  state.campaign = { ...state.campaign, status: body.status };
  return state.campaign;
}
```

**Valid Transitions**: Enforced by `assertReviewCampaignTransition()` from @uar/core

---

### 4.3 Ingest & Materialize

#### 4.3.1 Ingest CSV
**Route**: `POST /campaigns/:campaignId/ingest`  
**Handler**: line 202-276 (ingest function)  
**Response**: `{ itemCount: number }` (200)  
**Idempotent**: Yes (line 206-208)

**Domain Functions Called**:
1. `createCsvConnector()` (line 211-216)
   - Input: `{ tenantId, applicationId, csvContent, observedAt }`
   - CSV_PATH from env or default: `e2e/fixtures/access.csv` (line 72)
   
2. `connector.sync({ cursor: null })` (line 219-221)
   - Yields pages of ConnectorRecord[]
   
3. `materializeConnectorRecords()` (line 223-227)
   - Input: `{ tenantId, snapshotId, records }`
   - Output: `{ nodes: SnapshotNodeWrite[], edges: SnapshotEdgeWrite[] }`

**Item Generation Logic** (lines 232-268):
```typescript
for (const record of records) {
  if (record.recordType !== 'access_grant') continue;
  
  const grantId =
    readPayloadString(record.payload, 'grantId') ??
    `${record.applicationId}:${record.externalAccountId}`;
  
  const reviewItemId = `item-${state.campaign.snapshotId}-${grantId}`;
  
  const pendingItem = ReviewItemSchema.parse({
    tenantId: TENANT_ID,
    reviewItemId,
    campaignId: state.campaign.campaignId,
    snapshotId: state.campaign.snapshotId,
    accessGrantId: grantId,
    applicationId: record.applicationId,
    externalAccountId: record.externalAccountId,
    status: 'pending',
    suggestedReviewerUserIds: suggestReviewers({}),
    createdAt: FIXED_OBSERVED_AT,
  });
  
  // Auto-assign to reviewer
  assertReviewItemTransition(pendingItem.status, 'assigned');
  items.push(ReviewItemSchema.parse({ ...pendingItem, status: 'assigned' }));
  
  assignments.push(
    ReviewAssignmentSchema.parse({
      tenantId: TENANT_ID,
      assignmentId: `assign-${reviewItemId}`,
      campaignId: state.campaign.campaignId,
      reviewItemId,
      reviewerUserId: REVIEWER_USER_ID,
      status: 'assigned',
      assignedAt: FIXED_ASSIGNED_AT,
    }),
  );
}
```

**Key Details**:
- Review Item ID: `item-${snapshotId}-${grantId}`
- Assignment ID: `assign-${reviewItemId}`
- All items auto-assigned to REVIEWER_USER_ID
- Status transitions: pending → assigned (line 255-256)
- Timestamps: FIXED_OBSERVED_AT, FIXED_ASSIGNED_AT

---

### 4.4 Review Decisions

#### 4.4.1 Submit Decision
**Route**: `POST /review/campaigns/:campaignId/items/:itemId/decide`  
**Handler**: line 278-307 (decide function)  
**Request Body**: DecideBody  
**Response**: `ReviewDecision` (200)  
**Error**: 404 if item not found (line 282)

**Domain Functions Called**:
1. `ReviewDecisionSchema.parse()` (line 287-296)
2. `applyReviewDecision(item, decision)` (line 298)

**Implementation** (lines 278-307):
```typescript
function decide(campaignId: string, itemId: string, raw: string): ReviewDecision {
  const state = requireCampaign(campaignId);
  const item = state.items.find((candidate) => candidate.reviewItemId === itemId);
  if (item === undefined) {
    throw new HttpError(404, `Review item ${itemId} not found`);
  }
  const body = parseJsonBody(raw, DecideBody);
  const decisionId = `decision-${item.reviewItemId}`;
  
  const decision = ReviewDecisionSchema.parse({
    tenantId: TENANT_ID,
    decisionId,
    campaignId: state.campaign.campaignId,
    reviewItemId: item.reviewItemId,
    reviewerUserId: REVIEWER_USER_ID,
    decision: body.decision,
    decidedAt: FIXED_DECIDED_AT,
    note: body.note,
  });
  
  const updatedItem = applyReviewDecision(item, decision);
  state.items = state.items.map((candidate) =>
    candidate.reviewItemId === item.reviewItemId ? updatedItem : candidate,
  );
  state.decisions = [
    ...state.decisions.filter((existing) => existing.decisionId !== decisionId),
    decision,
  ];
  return decision;
}
```

**Decision ID**: `decision-${reviewItemId}`  
**Timestamp**: FIXED_DECIDED_AT (deterministic)  
**Decision Types**: approve | revoke | exception | needs_follow_up

---

### 4.5 Finalization & Export

#### 4.5.1 Finalize Review
**Route**: `POST /campaigns/:campaignId/finalize`  
**Handler**: line 309-335 (finalize function)  
**Response**: `{ contentHash: string; created: boolean }` (200)  
**Idempotent**: Yes (re-finalize returns same hash)

**Domain Functions Called**:
1. `finalizeReviewExport()` (line 312-324)
   - Input: `{ nodes, edges, decisions, assignments, tenantId, campaignId, snapshotId, finalizedAt }`
   - Output: `{ canonicalContent: string, contentHash: string, created: boolean }`

**Implementation** (lines 309-335):
```typescript
function finalize(campaignId: string): { contentHash: string; created: boolean } {
  const state = requireCampaign(campaignId);
  
  const result = finalizeReviewExport(
    {
      nodes: state.nodes.map((node) => ReviewContentNodeSchema.parse(node)),
      edges: state.edges.map((edge) => ReviewContentEdgeSchema.parse(edge)),
      decisions: state.decisions,
      assignments: state.assignments,
      tenantId: TENANT_ID,
      campaignId: state.campaign.campaignId,
      snapshotId: state.campaign.snapshotId,
      finalizedAt: new Date().toISOString(),
    },
    finalizeStore,
  );
  
  finalizedCanonical.set(campaignId, result.canonicalContent);
  finalizedHash.set(campaignId, result.contentHash);
  
  if (state.campaign.status !== 'completed') {
    assertReviewCampaignTransition(state.campaign.status, 'completed');
    state.campaign = { ...state.campaign, status: 'completed' };
  }
  
  return { contentHash: result.contentHash, created: result.created };
}
```

**Content Hash**: SHA-256 (64 hex chars), deterministic across runs  
**Canonical Content**: Stored in InMemoryFinalizationArtifactStore (line 92)

#### 4.5.2 Export CSV Evidence
**Route**: `GET /campaigns/:campaignId/export.csv`  
**Handler**: line 392-404  
**Response**: text/csv (200)  
**Error**: 409 if campaign not finalized (line 395)

**Implementation** (lines 392-404):
```typescript
if (method === 'GET' && sub === 'export.csv') {
  const canonical = finalizedCanonical.get(campaignId);
  if (canonical === undefined) {
    throw new HttpError(409, `Campaign ${campaignId} has not been finalized`);
  }
  res.writeHead(200, {
    ...CORS_HEADERS,
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="review-${campaignId}.csv"`,
  });
  res.end(renderCsvEvidence(canonical));
  return;
}
```

**Domain Function**: `renderCsvEvidence(canonicalContent)` (line 402)  
**CSV Columns**: section, recordJson (verified in e2e, line 129)  
**CSV Sections**: node, edge, decision, assignment

---

### 4.6 Reviewer View

#### 4.6.1 List Assigned Campaigns
**Route**: `GET /review/campaigns`  
**Handler**: line 337-341 (listReviewerCampaigns function)  
**Response**: `ReviewCampaign[]` (200)

**Implementation** (lines 337-341):
```typescript
function listReviewerCampaigns(): readonly ReviewCampaign[] {
  return [...campaigns.values()]
    .filter((state) => state.assignments.length > 0)
    .map((state) => state.campaign);
}
```

**Filter**: Only campaigns with assignments (reviewer has items to review)

#### 4.6.2 List Items in Campaign (Reviewer)
**Route**: `GET /review/campaigns/:campaignId/items`  
**Handler**: line 434-437  
**Response**: `ReviewItem[]` (200)

---

### 4.7 Item Details

#### 4.7.1 List All Items in Campaign
**Route**: `GET /campaigns/:campaignId/items`  
**Handler**: line 405-418  
**Response**: `ReviewItem[]` (200)

#### 4.7.2 Get Single Item
**Route**: `GET /campaigns/:campaignId/items/:itemId`  
**Handler**: line 405-418  
**Response**: `ReviewItem` (200)  
**Error**: 404 if item not found (line 414)

---

## 5. ERROR HANDLING

**HttpError Class** (lines 114-122):
```typescript
class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
```

**Error Response Format** (line 453):
```json
{ "error": "error message" }
```

**Status Codes**:
- 201: Created (POST /campaigns)
- 200: OK (all other successful responses)
- 204: No Content (OPTIONS)
- 400: Bad Request (invalid JSON, validation failure)
- 404: Not Found (campaign/item not found)
- 409: Conflict (export before finalize)
- 500: Internal Server Error (unhandled exception)

---

## 6. DETERMINISTIC LOGIC

**Fixed Timestamps** (lines 67-69):
```typescript
const FIXED_OBSERVED_AT = '2026-01-01T00:00:00.000Z';
const FIXED_ASSIGNED_AT = '2026-01-10T00:00:00.000Z';
const FIXED_DECIDED_AT = '2026-01-15T00:00:00.000Z';
```

**ID Generation**:
- Campaign: `campaign-${snapshotId}`
- Review Item: `item-${snapshotId}-${grantId}`
- Assignment: `assign-${reviewItemId}`
- Decision: `decision-${reviewItemId}`

**Determinism**: All IDs and timestamps are deterministic, so:
- Content hash is reproducible across runs
- Re-finalize returns same hash (idempotent)
- CSV export is byte-for-byte identical

---

## 7. IN-MEMORY STATE STRUCTURE

**CampaignState Interface** (lines 82-89):
```typescript
interface CampaignState {
  campaign: ReviewCampaign;
  items: ReviewItem[];
  decisions: ReviewDecision[];
  assignments: ReviewAssignment[];
  nodes: readonly SnapshotNodeWrite[];
  edges: readonly SnapshotEdgeWrite[];
}
```

**Global State** (lines 91-94):
```typescript
const campaigns = new Map<string, CampaignState>();
const finalizeStore = new InMemoryFinalizationArtifactStore();
const finalizedCanonical = new Map<string, string>();
const finalizedHash = new Map<string, string>();
```

---

## 8. DOMAIN FUNCTION IMPORTS

**From @uar/connectors** (line 30):
- `createCsvConnector(config)` → connector with `.sync()` method

**From @uar/core** (lines 31-47):
- `ReviewAssignmentSchema`, `ReviewCampaignSchema`, `ReviewDecisionSchema`, `ReviewItemSchema`
- `applyReviewDecision(item, decision)`
- `assertReviewCampaignSnapshotFrozen(state)`
- `assertReviewCampaignTransition(from, to)`
- `assertReviewItemTransition(from, to)`
- `suggestReviewers(config)`
- Type exports: `ConnectorRecord`, `ReviewAssignment`, `ReviewCampaign`, `ReviewCampaignStatus`, `ReviewDecision`, `ReviewItem`

**From @uar/api** (lines 48-52):
- `materializeConnectorRecords(config)` → `{ nodes, edges }`
- Type exports: `SnapshotEdgeWrite`, `SnapshotNodeWrite`

**From @uar/reporting** (lines 53-59):
- `InMemoryFinalizationArtifactStore` (class)
- `ReviewContentEdgeSchema`, `ReviewContentNodeSchema`
- `finalizeReviewExport(data, store)` → `{ canonicalContent, contentHash, created }`
- `renderCsvEvidence(canonicalContent)` → CSV string

---

## 9. CSV INPUT SCHEMA

**File**: e2e/fixtures/access.csv (5 lines: 1 header + 4 data rows)

**Columns**:
1. `externalAccountId` (string) — e.g., "acct-001"
2. `email` (string) — e.g., "alice@example.com"
3. `displayName` (string) — e.g., "Alice Anderson"
4. `grantId` (string) — e.g., "grant-001"
5. `accessId` (string) — e.g., "role-admin"
6. `accessLabel` (string) — e.g., "Production Administrator"
7. `accessType` (string) — e.g., "role"
8. `observedAt` (ISO 8601 timestamp) — e.g., "2026-01-01T00:00:00.000Z"

**Sample Data**:
```csv
externalAccountId,email,displayName,grantId,accessId,accessLabel,accessType,observedAt
acct-001,alice@example.com,Alice Anderson,grant-001,role-admin,Production Administrator,role,2026-01-01T00:00:00.000Z
acct-002,bob@example.com,Bob Brown,grant-002,role-engineer,Backend Engineer,role,2026-01-01T00:00:00.000Z
acct-003,carol@example.com,Carol Clark,grant-003,role-finance,Finance Analyst,role,2026-01-01T00:00:00.000Z
acct-004,dave@example.com,Dave Davis,grant-004,role-security,Security Auditor,role,2026-01-01T00:00:00.000Z
```

**Connector Processing**:
- `createCsvConnector()` parses CSV and yields pages of ConnectorRecord[]
- Each row becomes a ConnectorRecord with `recordType: 'access_grant'`
- `payload` contains the parsed row data
- `applicationId` is set to APPLICATION_ID constant ("app-e2e-okta")

---

## 10. E2E TEST FLOW

**File**: e2e/review-flow.spec.ts (142 lines)

**Test**: "create -> ingest -> review decisions -> finalize -> CSV export"

**Steps**:

1. **Create Campaign** (lines 51-62)
   - Navigate to `/campaigns`
   - Click `[data-testid="create-campaign-btn"]`
   - Fill form:
     - `[data-testid="name-input"]` = "E2E Access Review"
     - `[data-testid="snapshot-id-input"]` = "snap-e2e-001"
     - `[data-testid="starts-at-input"]` = "2026-01-05"
     - `[data-testid="due-at-input"]` = "2026-02-05"
   - Click `[data-testid="submit-btn"]`
   - Expect URL: `/campaigns/campaign-snap-e2e-001`

2. **Activate Campaign** (lines 64-66)
   - Click `[data-testid="activate-btn"]`
   - Expect `[data-testid="ingest-btn"]` visible

3. **Ingest CSV** (lines 68-70)
   - Click `[data-testid="ingest-btn"]`
   - Expect 4 `[data-testid="review-item-row"]` elements (one per grant)

4. **Reviewer View** (lines 72-89)
   - Navigate to `/review`
   - Expect 1 `[data-testid="assigned-campaign-row"]`
   - Click `[data-testid="review-campaign-btn"]`
   - Expect URL: `/review/campaign-snap-e2e-001`
   - Collect 4 item URLs from `[data-testid="decide-item-btn"]` href attributes

5. **Submit Decisions** (lines 91-99)
   - For each item (4 total):
     - Navigate to item URL
     - Click `[data-testid="decision-${action}-btn"]` (action cycles: approve, revoke, exception, needs_follow_up)
     - Fill `[data-testid="decision-note-input"]` = "e2e {action} justification"
     - Click `[data-testid="decision-submit-btn"]`
     - Expect status message: "Decision submitted"

6. **Finalize** (lines 101-107)
   - Navigate to `/campaigns/campaign-snap-e2e-001`
   - Click `[data-testid="finalize-btn"]`
   - Expect URL: `/campaigns/campaign-snap-e2e-001/finalize`
   - Click `[data-testid="finalize-submit-btn"]`
   - Expect `[data-testid="download-csv-btn"]` visible

7. **Verify Idempotency** (lines 109-119)
   - POST `/campaigns/campaign-snap-e2e-001/finalize` (first)
   - POST `/campaigns/campaign-snap-e2e-001/finalize` (second)
   - Expect both return 200 with same contentHash (64 hex chars)

8. **Download & Verify CSV** (lines 121-141)
   - Click `[data-testid="download-csv-btn"]`
   - Wait for download
   - Read CSV file
   - Verify header: "section,recordJson"
   - Verify sections present: "node,", "edge,", "decision,", "assignment,"
   - Verify all 4 grant IDs present: grant-001, grant-002, grant-003, grant-004
   - Verify all 4 decision actions present: approve, revoke, exception, needs_follow_up
   - Verify reviewer ID: "reviewer-e2e"
   - Verify edge type: "has_grant"

---

## 11. PRODUCTION IMPLEMENTATION CHECKLIST

- [ ] Replace hardcoded TENANT_ID with token claim extraction
- [ ] Replace hardcoded REVIEWER_USER_ID with token claim extraction
- [ ] Replace hardcoded APPLICATION_ID with request parameter or config
- [ ] Replace in-memory campaigns Map with Drizzle/Postgres tables
- [ ] Replace InMemoryFinalizationArtifactStore with Postgres blob storage
- [ ] Implement Descope token validation in auth middleware
- [ ] Add request logging/tracing
- [ ] Add database transaction handling
- [ ] Implement proper error recovery (rollback on partial failures)
- [ ] Add rate limiting
- [ ] Add request validation middleware
- [ ] Implement audit logging for decisions
- [ ] Add metrics/observability
- [ ] Test with real Descope tokens
- [ ] Load test with concurrent campaigns
- [ ] Verify CSV export determinism with production data

