import type { TenantContext } from '@uar/core';
import { z } from 'zod';

import type { DescopeSessionVerifier } from '../auth/descope.js';
import { SessionVerificationError } from '../auth/descope.js';
import { resolveTenantContextFromAuthorization, TenantResolutionError } from '../auth/tenant-resolver.js';
import { DEFAULT_AUTHZ_FLAGS, type AuthzFlags } from '../config/flags.js';

export const AuthzFailureCodes = {
  unauthenticated: 'unauthenticated',
  forbidden: 'forbidden',
} as const;

export type AuthzFailureCode = (typeof AuthzFailureCodes)[keyof typeof AuthzFailureCodes];

export type AuthzFailureStatus = 401 | 403;

export interface AuthzHeaders {
  readonly get: (name: string) => string | null;
}

export interface AuthzRequest {
  readonly headers: AuthzHeaders;
}

export type AuthorizedAuthzRequest<TRequest extends AuthzRequest> = TRequest & {
  readonly tenantContext: TenantContext;
};

export interface AuthzFailureResponse {
  readonly status: AuthzFailureStatus;
  readonly body: {
    readonly error: AuthzFailureCode;
    readonly message: string;
  };
}

export const AuthzObjectScopeSchema = z.object({
  tenantId: z.string().trim().min(1),
  objectType: z.string().trim().min(1),
  objectId: z.string().trim().min(1),
});

export type AuthzObjectScope = z.infer<typeof AuthzObjectScopeSchema>;

export type AuthzObjectScopeResolver<TRequest extends AuthzRequest = AuthzRequest> = (
  request: TRequest,
  tenantContext: TenantContext,
) => AuthzObjectScope | undefined | Promise<AuthzObjectScope | undefined>;

export interface AuthzMiddlewareOptions<TRequest extends AuthzRequest = AuthzRequest> {
  readonly verifier: DescopeSessionVerifier;
  readonly flags?: AuthzFlags;
  readonly objectScopeResolver?: AuthzObjectScopeResolver<TRequest>;
}

export type AuthzNext<TRequest extends AuthzRequest, TResponse> = (
  request: AuthorizedAuthzRequest<TRequest>,
) => TResponse | Promise<TResponse>;

export interface AuthzMiddleware<TRequest extends AuthzRequest = AuthzRequest> {
  <TResponse>(
    request: TRequest,
    next: AuthzNext<TRequest, TResponse>,
  ): Promise<TResponse | AuthzFailureResponse>;
}

type AuthzDecision =
  | { readonly kind: 'allow'; readonly tenantContext: TenantContext }
  | { readonly kind: 'deny'; readonly response: AuthzFailureResponse };

class AuthzInvariantError extends Error {
  constructor(value: never) {
    super(`Unexpected authz decision: ${JSON.stringify(value)}`);
    this.name = 'AuthzInvariantError';
  }
}

class AuthzObjectScopeError extends Error {
  constructor(options?: ErrorOptions) {
    super('AuthZ object scope is invalid', options);
    this.name = 'AuthzObjectScopeError';
  }
}

export function createAuthzMiddleware<TRequest extends AuthzRequest = AuthzRequest>(
  options: AuthzMiddlewareOptions<TRequest>,
): AuthzMiddleware<TRequest> {
  return async (request, next) => runAuthzMiddleware(request, options, next);
}

export async function runAuthzMiddleware<TRequest extends AuthzRequest, TResponse>(
  request: TRequest,
  options: AuthzMiddlewareOptions<TRequest>,
  next: AuthzNext<TRequest, TResponse>,
): Promise<TResponse | AuthzFailureResponse> {
  try {
    const decision = await authorizeRequest(request, options);

    switch (decision.kind) {
      case 'allow':
        return next({ ...request, tenantContext: decision.tenantContext });
      case 'deny':
        return decision.response;
      default:
        return assertNever(decision);
    }
  } catch (error) {
    if (error instanceof AuthzObjectScopeError) {
      return forbiddenResponse();
    }

    throw error;
  }
}

export async function authorizeRequest<TRequest extends AuthzRequest>(
  request: TRequest,
  options: AuthzMiddlewareOptions<TRequest>,
): Promise<AuthzDecision> {
  const flags = options.flags ?? DEFAULT_AUTHZ_FLAGS;
  if (flags.stubAuthz) {
    return { kind: 'allow', tenantContext: flags.stubTenantContext };
  }

  const tenantDecision = await resolveTenantDecision(request, options.verifier);

  switch (tenantDecision.kind) {
    case 'deny':
      return tenantDecision;
    case 'allow':
      break;
    default:
      return assertNever(tenantDecision);
  }

  const tenantContext = tenantDecision.tenantContext;
  const objectScope = await resolveObjectScope(request, tenantContext, options.objectScopeResolver);
  if (objectScope !== undefined && objectScope.tenantId !== tenantContext.tenantId) {
    return { kind: 'deny', response: forbiddenResponse() };
  }

  return { kind: 'allow', tenantContext };
}

async function resolveTenantDecision<TRequest extends AuthzRequest>(
  request: TRequest,
  verifier: DescopeSessionVerifier,
): Promise<AuthzDecision> {
  try {
    const tenantContext = await resolveTenantContextFromAuthorization(
      readAuthorizationHeader(request),
      verifier,
    );

    return { kind: 'allow', tenantContext };
  } catch (error) {
    if (error instanceof SessionVerificationError || error instanceof TenantResolutionError) {
      return { kind: 'deny', response: unauthenticatedResponse() };
    }

    throw error;
  }
}

async function resolveObjectScope<TRequest extends AuthzRequest>(
  request: TRequest,
  tenantContext: TenantContext,
  resolver: AuthzObjectScopeResolver<TRequest> | undefined,
): Promise<AuthzObjectScope | undefined> {
  if (resolver === undefined) {
    return undefined;
  }

  const scope = await resolver(request, tenantContext);
  if (scope === undefined) {
    return undefined;
  }

  const parsedScope = AuthzObjectScopeSchema.safeParse(scope);
  if (!parsedScope.success) {
    throw new AuthzObjectScopeError({ cause: parsedScope.error });
  }

  return parsedScope.data;
}

function readAuthorizationHeader(request: AuthzRequest): string | undefined {
  return request.headers.get('authorization') ?? undefined;
}

function unauthenticatedResponse(): AuthzFailureResponse {
  return {
    status: 401,
    body: {
      error: AuthzFailureCodes.unauthenticated,
      message: 'Authentication required',
    },
  };
}

function forbiddenResponse(): AuthzFailureResponse {
  return {
    status: 403,
    body: {
      error: AuthzFailureCodes.forbidden,
      message: 'Tenant access denied',
    },
  };
}

function assertNever(value: never): never {
  throw new AuthzInvariantError(value);
}
