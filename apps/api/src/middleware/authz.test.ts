import { describe, expect, it } from 'vitest';

import type { TenantContext } from '@uar/core';
import type { DescopeSessionVerifier, VerifiedDescopeSession } from '../auth/descope.js';
import { loadAuthzFlags } from '../config/flags.js';
import { createAuthzMiddleware, type AuthzObjectScope, type AuthzRequest } from './authz.js';

interface TestHeaders {
  readonly get: (name: string) => string | null;
}

interface TestRequest extends AuthzRequest {
  readonly path: string;
  readonly targetTenantId?: string;
}

interface TestEndpointResponse {
  readonly status: 200;
  readonly body: {
    readonly endpoint: string;
    readonly tenantId: string;
    readonly userId: string;
    readonly roles: readonly string[];
  };
}

const tenantSession: VerifiedDescopeSession = {
  token: 'session.jwt',
  claims: {
    sub: '22222222-2222-4222-8222-222222222222',
    dct: '11111111-1111-4111-8111-111111111111',
    roles: ['reviewer'],
  },
};

function makeHeaders(headers: Record<string, string>): TestHeaders {
  const normalizedHeaders = new Map(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );

  return {
    get: (name) => normalizedHeaders.get(name.toLowerCase()) ?? null,
  };
}

function makeRequest(input: {
  readonly path: string;
  readonly headers?: Record<string, string>;
  readonly targetTenantId?: string;
}): TestRequest {
  return {
    path: input.path,
    headers: makeHeaders(input.headers ?? {}),
    targetTenantId: input.targetTenantId,
  };
}

function createVerifier(session: VerifiedDescopeSession): DescopeSessionVerifier {
  return {
    verifySessionToken: async (sessionToken) => ({
      ...session,
      token: sessionToken,
    }),
  };
}

function objectScopeFromRequest(request: TestRequest): AuthzObjectScope | undefined {
  if (request.targetTenantId === undefined) {
    return undefined;
  }

  return {
    tenantId: request.targetTenantId,
    objectType: 'campaign',
    objectId: 'campaign-1',
  };
}

describe('authz middleware', () => {
  it('denies unauthenticated requests when STUB_AUTHZ is false', async () => {
    // Given
    let nextCalls = 0;
    const middleware = createAuthzMiddleware<TestRequest>({
      verifier: createVerifier(tenantSession),
      flags: loadAuthzFlags({ STUB_AUTHZ: 'false' }),
      objectScopeResolver: objectScopeFromRequest,
    });

    // When
    const response = await middleware(makeRequest({ path: '/campaigns' }), async (request) => {
      nextCalls += 1;
      return endpointResponse(request.path, request.tenantContext);
    });

    // Then
    expect(response).toEqual({
      status: 401,
      body: {
        error: 'unauthenticated',
        message: 'Authentication required',
      },
    });
    expect(nextCalls).toBe(0);
  });

  it('denies cross-tenant object requests when STUB_AUTHZ is false', async () => {
    // Given
    let nextCalls = 0;
    const middleware = createAuthzMiddleware<TestRequest>({
      verifier: createVerifier(tenantSession),
      flags: loadAuthzFlags({ STUB_AUTHZ: 'false' }),
      objectScopeResolver: objectScopeFromRequest,
    });

    // When
    const response = await middleware(
      makeRequest({
        path: '/campaigns/campaign-1',
        headers: { authorization: 'Bearer session.jwt' },
        targetTenantId: '33333333-3333-4333-8333-333333333333',
      }),
      async (request) => {
        nextCalls += 1;
        return endpointResponse(request.path, request.tenantContext);
      },
    );

    // Then
    expect(response).toEqual({
      status: 403,
      body: {
        error: 'forbidden',
        message: 'Tenant access denied',
      },
    });
    expect(nextCalls).toBe(0);
  });

  it('allows same-tenant object requests and passes tenant context to the endpoint', async () => {
    // Given
    const middleware = createAuthzMiddleware<TestRequest>({
      verifier: createVerifier(tenantSession),
      flags: loadAuthzFlags({ STUB_AUTHZ: 'false' }),
      objectScopeResolver: objectScopeFromRequest,
    });

    // When
    const response = await middleware(
      makeRequest({
        path: '/campaigns/campaign-1',
        headers: { authorization: 'Bearer session.jwt' },
        targetTenantId: '11111111-1111-4111-8111-111111111111',
      }),
      async (request) => endpointResponse(request.path, request.tenantContext),
    );

    // Then
    expect(response).toEqual({
      status: 200,
      body: {
        endpoint: '/campaigns/campaign-1',
        tenantId: '11111111-1111-4111-8111-111111111111',
        userId: '22222222-2222-4222-8222-222222222222',
        roles: ['reviewer'],
      },
    });
  });

  it('uses one mounted middleware to guard every endpoint handler', async () => {
    // Given
    const guardedEndpointPaths = ['/campaigns', '/review/items'] as const;
    const middleware = createAuthzMiddleware<TestRequest>({
      verifier: createVerifier(tenantSession),
      flags: loadAuthzFlags({ STUB_AUTHZ: 'false' }),
      objectScopeResolver: objectScopeFromRequest,
    });

    // When
    const responses = await Promise.all(
      guardedEndpointPaths.map((path) =>
        middleware(makeRequest({ path }), async (request) =>
          endpointResponse(request.path, request.tenantContext),
        ),
      ),
    );

    // Then
    expect(responses).toEqual([
      {
        status: 401,
        body: {
          error: 'unauthenticated',
          message: 'Authentication required',
        },
      },
      {
        status: 401,
        body: {
          error: 'unauthenticated',
          message: 'Authentication required',
        },
      },
    ]);
  });

  it('bypasses Descope and tenant object checks only when STUB_AUTHZ is true outside production', async () => {
    // Given
    let verifierCalls = 0;
    const verifier: DescopeSessionVerifier = {
      verifySessionToken: async (sessionToken) => {
        verifierCalls += 1;
        return {
          ...tenantSession,
          token: sessionToken,
        };
      },
    };
    const middleware = createAuthzMiddleware<TestRequest>({
      verifier,
      flags: loadAuthzFlags({
        STUB_AUTHZ: 'true',
        NODE_ENV: 'development',
        UAR_STUB_TENANT_ID: 'local-tenant',
        UAR_STUB_USER_ID: 'local-user',
        UAR_STUB_ROLES: 'admin,reviewer',
      }),
      objectScopeResolver: objectScopeFromRequest,
    });

    // When
    const response = await middleware(
      makeRequest({ path: '/campaigns/campaign-1', targetTenantId: '33333333-3333-4333-8333-333333333333' }),
      async (request) => endpointResponse(request.path, request.tenantContext),
    );

    // Then
    expect(response).toEqual({
      status: 200,
      body: {
        endpoint: '/campaigns/campaign-1',
        tenantId: 'local-tenant',
        userId: 'local-user',
        roles: ['admin', 'reviewer'],
      },
    });
    expect(verifierCalls).toBe(0);
  });

  it('defaults STUB_AUTHZ to false and rejects STUB_AUTHZ=true in production', () => {
    // Given / When / Then
    expect(loadAuthzFlags({}).stubAuthz).toBe(false);
    expect(() => loadAuthzFlags({ STUB_AUTHZ: 'true', NODE_ENV: 'production' })).toThrow(
      'STUB_AUTHZ is not allowed in production',
    );
  });
});

function endpointResponse(path: string, tenantContext: TenantContext): TestEndpointResponse {
  return {
    status: 200,
    body: {
      endpoint: path,
      tenantId: tenantContext.tenantId,
      userId: tenantContext.userId,
      roles: tenantContext.roles,
    },
  };
}
