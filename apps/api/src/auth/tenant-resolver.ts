import { TenantContextSchema, type TenantContext } from '@uar/core';

import {
  verifyBearerSession,
  type DescopeSessionVerifier,
  type VerifiedDescopeSession,
} from './descope.js';

export const TenantResolutionErrorCodes = {
  missingTenant: 'missing_tenant',
  ambiguousTenant: 'ambiguous_tenant',
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

  return TenantContextSchema.parse({
    tenantId,
    userId: session.claims.sub,
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
