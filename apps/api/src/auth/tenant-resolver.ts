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

// Descope IDs use a proprietary format (T... for tenants, U... for users),
// not UUIDs. Validate they're non-empty strings only.
const DESCOPE_ID_PATTERN = /^[A-Za-z0-9]{10,}/;

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
  if (!DESCOPE_ID_PATTERN.test(tenantId)) {
    throw new TenantResolutionError(
      TenantResolutionErrorCodes.invalidIdentity,
      'Verified Descope session tenant claim is not a valid Descope tenant ID',
    );
  }
  if (!DESCOPE_ID_PATTERN.test(userId)) {
    throw new TenantResolutionError(
      TenantResolutionErrorCodes.invalidIdentity,
      'Verified Descope session subject is not a valid Descope user ID',
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
