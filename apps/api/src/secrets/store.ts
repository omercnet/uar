import { and, eq } from 'drizzle-orm';

import { decryptSecret, encryptSecret, type EncryptionContext, type KeyEncryptionProvider } from '@uar/core';

import type { DatabaseClient } from '../db/client.js';
import { connectorCredentials } from '../db/schema/index.js';

export type ConnectorCredentialSelector = {
  readonly tenantId: string;
  readonly applicationId: string;
  readonly name: string;
};

export type StoreConnectorCredentialSecretInput = ConnectorCredentialSelector & {
  readonly db: DatabaseClient;
  readonly provider: KeyEncryptionProvider;
  readonly plaintext: string;
};

export type LoadConnectorCredentialSecretInput = ConnectorCredentialSelector & {
  readonly db: DatabaseClient;
  readonly provider: KeyEncryptionProvider;
};

export function createConnectorCredentialEncryptionContext({
  tenantId,
  applicationId,
  name,
}: ConnectorCredentialSelector): EncryptionContext {
  return {
    tenantId,
    applicationId,
    secretName: name,
  };
}

export async function storeConnectorCredentialSecret({
  db,
  provider,
  plaintext,
  tenantId,
  applicationId,
  name,
}: StoreConnectorCredentialSecretInput): Promise<void> {
  const context = createConnectorCredentialEncryptionContext({ tenantId, applicationId, name });
  const encryptedSecret = await encryptSecret({ plaintext, provider, context });
  const updatedAt = new Date();

  await db
    .insert(connectorCredentials)
    .values({
      tenantId,
      applicationId,
      name,
      encryptedSecret,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: [connectorCredentials.tenantId, connectorCredentials.applicationId, connectorCredentials.name],
      set: {
        encryptedSecret,
        updatedAt,
      },
    });
}

export async function loadConnectorCredentialSecret({
  db,
  provider,
  tenantId,
  applicationId,
  name,
}: LoadConnectorCredentialSecretInput): Promise<string | null> {
  const [row] = await db
    .select({ encryptedSecret: connectorCredentials.encryptedSecret })
    .from(connectorCredentials)
    .where(
      and(
        eq(connectorCredentials.tenantId, tenantId),
        eq(connectorCredentials.applicationId, applicationId),
        eq(connectorCredentials.name, name),
      ),
    )
    .limit(1);

  if (row === undefined) {
    return null;
  }

  const context = createConnectorCredentialEncryptionContext({ tenantId, applicationId, name });

  return decryptSecret({ envelope: row.encryptedSecret, provider, context });
}
