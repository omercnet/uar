import { TenantContextSchema, type TenantContext } from '@uar/core';
import { z } from 'zod';

const NonEmptyStringSchema = z.string().trim().min(1);

const AuthzFlagInputSchema = z
  .object({
    STUB_AUTHZ: z.enum(['true', 'false']).optional().default('false'),
    NODE_ENV: NonEmptyStringSchema.optional().default('development'),
    UAR_STUB_TENANT_ID: NonEmptyStringSchema.optional().default('local-dev-tenant'),
    UAR_STUB_USER_ID: NonEmptyStringSchema.optional().default('local-dev-user'),
    UAR_STUB_ROLES: z.string().optional().default('admin'),
  })
  .passthrough();

export interface AuthzFlags {
  readonly stubAuthz: boolean;
  readonly runtimeEnvironment: string;
  readonly stubTenantContext: TenantContext;
}

export class AuthzFlagConfigurationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AuthzFlagConfigurationError';
  }
}

export function loadAuthzFlags(env: Record<string, string | undefined> = process.env): AuthzFlags {
  const parsedInput = AuthzFlagInputSchema.safeParse(env);
  if (!parsedInput.success) {
    throw new AuthzFlagConfigurationError('AuthZ flags are invalid', { cause: parsedInput.error });
  }

  if (parsedInput.data.STUB_AUTHZ === 'true' && parsedInput.data.NODE_ENV === 'production') {
    throw new AuthzFlagConfigurationError('STUB_AUTHZ is not allowed in production');
  }

  return {
    stubAuthz: parsedInput.data.STUB_AUTHZ === 'true',
    runtimeEnvironment: parsedInput.data.NODE_ENV,
    stubTenantContext: TenantContextSchema.parse({
      tenantId: parsedInput.data.UAR_STUB_TENANT_ID,
      userId: parsedInput.data.UAR_STUB_USER_ID,
      roles: parseStubRoles(parsedInput.data.UAR_STUB_ROLES),
    }),
  };
}

export const DEFAULT_AUTHZ_FLAGS = loadAuthzFlags({});

function parseStubRoles(roles: string): string[] {
  return roles
    .split(',')
    .map((role) => role.trim())
    .filter((role) => role.length > 0);
}
