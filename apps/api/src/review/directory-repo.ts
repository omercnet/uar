import { ConnectorRecordSchema, type ConnectorRecord } from '@uar/core';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { accessGrants, applications, externalAccounts, userIdentities } from '../db/schema/index.js';
import type { TenantDb } from '../db/tenant-context.js';

const connectorId = 'manual-csv' as const;

const AccessGrantPayloadSchema = z.object({
  externalAccountId: z.string().min(1),
  email: z.email(),
  displayName: z.string().min(1),
  grantId: z.string().min(1),
  accessType: z.string().min(1),
  accessId: z.string().min(1),
  accessLabel: z.string().min(1),
  source: z.string().min(1),
});

type AccessGrantPayload = z.infer<typeof AccessGrantPayloadSchema>;

export type DirectoryGraphIds = {
  readonly applicationId: string;
  readonly externalAccountId: string;
  readonly accessGrantId: string;
  readonly userIdentityId: string;
};

export type DirectoryGraphReferenceMaps = {
  readonly applications: Record<string, Pick<DirectoryGraphIds, 'applicationId'>>;
  readonly userIdentities: Record<string, Pick<DirectoryGraphIds, 'userIdentityId'>>;
  readonly externalAccounts: Record<string, Pick<DirectoryGraphIds, 'applicationId' | 'externalAccountId' | 'userIdentityId'>>;
  readonly accessGrants: Record<string, DirectoryGraphIds>;
};

type DirectoryRecord = {
  readonly applicationKey: string;
  readonly externalAccountKey: string;
  readonly payload: AccessGrantPayload;
};

type DirectoryGraphRow = {
  readonly tenantId: string;
  readonly applicationId: string;
  readonly userIdentityId: string;
  readonly externalAccountId: string;
  readonly payload: AccessGrantPayload;
};

export async function upsertDirectoryGraph(
  tx: TenantDb,
  tenantId: string,
  records: readonly ConnectorRecord[],
): Promise<DirectoryGraphReferenceMaps> {
  const result: DirectoryGraphReferenceMaps = {
    applications: {},
    userIdentities: {},
    externalAccounts: {},
    accessGrants: {},
  };

  for (const inputRecord of records) {
    const record = ConnectorRecordSchema.parse(inputRecord);

    if (record.recordType !== 'access_grant') {
      continue;
    }

    const directoryRecord = toDirectoryRecord(record);
    const graphRow = await upsertDirectoryRecord(tx, tenantId, directoryRecord);
    const accessGrantId = await upsertAccessGrant(tx, graphRow);
    const ids = {
      applicationId: graphRow.applicationId,
      externalAccountId: graphRow.externalAccountId,
      accessGrantId,
      userIdentityId: graphRow.userIdentityId,
    } satisfies DirectoryGraphIds;

    result.applications[directoryRecord.applicationKey] = { applicationId: ids.applicationId };
    result.userIdentities[directoryRecord.payload.email] = { userIdentityId: ids.userIdentityId };
    result.externalAccounts[directoryRecord.externalAccountKey] = {
      applicationId: ids.applicationId,
      externalAccountId: ids.externalAccountId,
      userIdentityId: ids.userIdentityId,
    };
    result.accessGrants[directoryRecord.payload.grantId] = ids;
  }

  return result;
}

function toDirectoryRecord(record: ConnectorRecord): DirectoryRecord {
  const payload = AccessGrantPayloadSchema.parse(record.payload);

  return {
    applicationKey: record.applicationId,
    externalAccountKey: record.externalAccountId,
    payload,
  };
}

async function upsertDirectoryRecord(
  tx: TenantDb,
  tenantId: string,
  record: DirectoryRecord,
): Promise<DirectoryGraphRow> {
  const applicationId = await upsertApplication(tx, tenantId, record.applicationKey);
  const userIdentityId = await upsertUserIdentity(tx, tenantId, record.payload);
  const externalAccountId = await upsertExternalAccount(tx, {
    tenantId,
    applicationId,
    userIdentityId,
    externalAccountKey: record.externalAccountKey,
    displayName: record.payload.displayName,
  });

  return { tenantId, applicationId, userIdentityId, externalAccountId, payload: record.payload };
}

async function upsertApplication(tx: TenantDb, tenantId: string, applicationKey: string): Promise<string> {
  await tx
    .insert(applications)
    .values({ tenantId, key: applicationKey, name: applicationKey, connectorId })
    .onConflictDoNothing({ target: [applications.tenantId, applications.key] });

  const [row] = await tx
    .select({ id: applications.id })
    .from(applications)
    .where(and(eq(applications.tenantId, tenantId), eq(applications.key, applicationKey)))
    .limit(1);

  return requireResolvedId(row, 'application');
}

async function upsertUserIdentity(tx: TenantDb, tenantId: string, payload: AccessGrantPayload): Promise<string> {
  await tx
    .insert(userIdentities)
    .values({ tenantId, primaryEmail: payload.email, displayName: payload.displayName })
    .onConflictDoNothing({ target: [userIdentities.tenantId, userIdentities.primaryEmail] });

  const [row] = await tx
    .select({ id: userIdentities.id })
    .from(userIdentities)
    .where(and(eq(userIdentities.tenantId, tenantId), eq(userIdentities.primaryEmail, payload.email)))
    .limit(1);

  return requireResolvedId(row, 'user identity');
}

type ExternalAccountInput = {
  readonly tenantId: string;
  readonly applicationId: string;
  readonly userIdentityId: string;
  readonly externalAccountKey: string;
  readonly displayName: string;
};

async function upsertExternalAccount(tx: TenantDb, input: ExternalAccountInput): Promise<string> {
  await tx
    .insert(externalAccounts)
    .values({
      tenantId: input.tenantId,
      applicationId: input.applicationId,
      userIdentityId: input.userIdentityId,
      externalId: input.externalAccountKey,
      displayName: input.displayName,
    })
    .onConflictDoNothing({
      target: [externalAccounts.tenantId, externalAccounts.applicationId, externalAccounts.externalId],
    });

  const [row] = await tx
    .select({ id: externalAccounts.id })
    .from(externalAccounts)
    .where(
      and(
        eq(externalAccounts.tenantId, input.tenantId),
        eq(externalAccounts.applicationId, input.applicationId),
        eq(externalAccounts.externalId, input.externalAccountKey),
      ),
    )
    .limit(1);

  return requireResolvedId(row, 'external account');
}

async function upsertAccessGrant(tx: TenantDb, row: DirectoryGraphRow): Promise<string> {
  await tx
    .insert(accessGrants)
    .values({
      tenantId: row.tenantId,
      applicationId: row.applicationId,
      externalAccountId: row.externalAccountId,
      userIdentityId: row.userIdentityId,
      grantType: row.payload.accessType,
      grantValue: row.payload.accessLabel,
      source: connectorId,
    })
    .onConflictDoNothing({
      target: [accessGrants.tenantId, accessGrants.externalAccountId, accessGrants.grantType, accessGrants.grantValue],
    });

  const [grant] = await tx
    .select({ id: accessGrants.id })
    .from(accessGrants)
    .where(
      and(
        eq(accessGrants.tenantId, row.tenantId),
        eq(accessGrants.externalAccountId, row.externalAccountId),
        eq(accessGrants.grantType, row.payload.accessType),
        eq(accessGrants.grantValue, row.payload.accessLabel),
      ),
    )
    .limit(1);

  return requireResolvedId(grant, 'access grant');
}

function requireResolvedId(row: { readonly id: string } | undefined, entityName: string): string {
  if (row === undefined) {
    throw new DirectoryGraphResolveError(entityName);
  }

  return row.id;
}

export class DirectoryGraphResolveError extends Error {
  override readonly name = 'DirectoryGraphResolveError';

  constructor(readonly entityName: string) {
    super(`Directory graph ${entityName} row was not resolved after upsert.`);
  }
}
