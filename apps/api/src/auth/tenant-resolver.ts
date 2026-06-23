import { TenantContextSchema, type TenantContext } from '@uar/core';

import {
  verifyBearerSession,
  type DescopeSessionVerifier,
  type VerifiedDescopeSession,
} from './descope.js';

export const TenantResolutionErrorCodes = {
  missingTenant: 'missing_tenant',
  ambiguousTenant: 'ambiguous_tenant',
  invalidIdentity: 'invalid_identity',
} as const;

export type TenantResolutionErrorCode =
  (typeof TenantResolutionErrorCodes)[keyof typeof TenantResolutionErrorCodes];

export class TenantResolutionError extends Error {
  readonly code: TenantResolutionErrorCode;

  constructor(code: TenantResolutionErrorCode, message: string) {
    super(message);
    this.name = 'TenantResolutionError';
    this.code = code;
  }
}

const IDENTITY_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function resolveTenantContext(session: VerifiedDescopeSession): TenantContext {
  const tenantCandidates = [session.claims.dct, session.claims.tenant_id].filter(
    (tenantId): tenantId is string => tenantId !== undefined,
  );
  const tenantIds = [...new Set(tenantCandidates)];

  if (tenantIds.length === 0) {
    throw new TenantResolutionError(
      TenantResolutionErrorCodes.missingTenant,
      'Verified Descope session has no tenant claim',
    );
  }

  if (tenantIds.length > 1) {
    throw new TenantResolutionError(
      TenantResolutionErrorCodes.ambiguousTenant,
      'Verified Descope session has conflicting tenant claims',
    );
  }

  const tenantId = tenantIds[0];
  if (tenantId === undefined) {
    throw new TenantResolutionError(
      TenantResolutionErrorCodes.missingTenant,
      'Verified Descope session has no tenant claim',
    );
  }

  const userId = session.claims.sub;
  if (!IDENTITY_UUID_PATTERN.test(tenantId)) {
    throw new TenantResolutionError(
      TenantResolutionErrorCodes.invalidIdentity,
      'Verified Descope session tenant claim is not a valid tenant id (expected a UUID matching a provisioned tenant)',
    );
  }
  if (!IDENTITY_UUID_PATTERN.test(userId)) {
    throw new TenantResolutionError(
      TenantResolutionErrorCodes.invalidIdentity,
      'Verified Descope session subject is not a valid user id (expected a UUID matching a provisioned identity)',
    );
  }

  return TenantContextSchema.parse({
    tenantId,
    userId,
    roles: session.claims.roles ?? [],
  });
}

export async function resolveTenantContextFromAuthorization(
  authorizationHeader: string | undefined,
  verifier: DescopeSessionVerifier,
): Promise<TenantContext> {
  const session = await verifyBearerSession(authorizationHeader, verifier);

  return resolveTenantContext(session);
}
