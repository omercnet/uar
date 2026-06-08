# Descope Outbound Apps 48h contract spike

## Verdict

**Verdict: fallback-to-IdP-only.** The connector skeleton can emit contract-valid identity, group, role, and provenance records from a hermetic Descope client adapter, but the spike does not prove field 3: stable app-level access grants from Descope Outbound Apps. Per the pre-declared rule, failing a hard app-level grants field scopes Descope to IdP-only and leaves app entitlement coverage to GitHub/GWS-style connectors.

## Contract artifact

- Connector package: `@uar/connectors`
- Connector entrypoint: `packages/connectors/src/descope-outbound/index.ts`
- Contract source: `@uar/core` `CapabilityDescriptor`, `SyncResult`, `ConnectorRecord`, `ConnectorError`
- Fixture: `packages/connectors/src/descope-outbound/spike/fixture.json`
- Conformance test: `packages/connectors/src/descope-outbound/spike/fixture.test.ts`

The spike is hermetic: no network calls are made. Descope responses are mocked behind `DescopeOutboundAppsClient`, then parsed through the core schemas in tests.

## CapabilityDescriptor

```json
{
  "contractVersion": "1.0.0",
  "connectorId": "descope-outbound-apps",
  "capabilities": {
    "users": true,
    "groups": true,
    "roles": true,
    "permissions": false,
    "access_grants": false,
    "owners": false,
    "revoke": false,
    "evidence_links": true
  }
}
```

`access_grants: false` is intentional. The skeleton records an `outbound_app_assignment_probe` for traceability, but does not claim grant coverage because no stable app-level grant shape was proven.

## Six-field rubric

| # | Field | Hard? | Result | Contract evidence | Notes |
|---|---|---:|---|---|---|
| 1 | Org-wide user enumeration | Yes | Pass for skeleton | `user` `ConnectorRecord` in `fixture.json`; cursor-aware `sync()` | Mocked page proves contract mapping only. Live API pagination and tenant-wide completeness still need vendor validation. |
| 2 | Role/group membership | Yes | Pass for skeleton | `group_membership` records; connector also maps optional `roles` to `role_membership` | Sufficient for IdP-style identity context. |
| 3 | App-level access grants | Yes | Fail | `access_grants: false`; `outbound_app_assignment_probe.grantObserved=false` | No proven stable `grantId`, `principalId`, `accessId`, grant lifecycle, or deletion semantics for downstream app entitlements. This triggers fallback. |
| 4 | Owners | No | Fail | `owners: false` | No owner record shape is claimed. |
| 5 | Stable external IDs + deletion/disabled semantics | No | Partial | `externalAccountId=descope_user_<id>`, payload has `disabled` and `deleted` | User-level semantics are represented; grant-level deletion semantics are not proven. |
| 6 | Provenance | No | Pass for skeleton | Every record payload includes `provenance`; manifest identifies connector/schema | Hermetic provenance is fixture-level, not live evidence URL-level. |

## Recommendation

Use Descope as an IdP-only connector for user, group, and role context. Do not use Descope Outbound Apps as the source of record for app-level access reviews until a live API proof can produce contract-valid `access_grant` records with stable IDs, lifecycle semantics, and evidence links.
