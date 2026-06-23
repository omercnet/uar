import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DescopeSdkClient, DescopeSessionVerifier, VerifiedDescopeSession } from './descope.js';
import {
  createDescopeSdkSessionVerifier,
  createDescopeSessionVerifier,
  SessionVerificationError,
  verifyBearerSession,
} from './descope.js';
import {
  resolveTenantContext,
  resolveTenantContextFromAuthorization,
  TenantResolutionError,
} from './tenant-resolver.js';

const descopeSdkMock = vi.hoisted(() => {
  const configs: unknown[] = [];
  const validateSession = vi.fn<DescopeSdkClient['validateSession']>();
  const client = vi.fn((config: unknown) => {
    configs.push(config);
    return { validateSession };
  });

  return { client, configs, validateSession };
});

vi.mock('@descope/node-sdk', () => ({
  default: descopeSdkMock.client,
}));

function captureTenantResolutionError(action: () => void): TenantResolutionError | undefined {
  try {
    action();
    return undefined;
  } catch (error) {
    if (error instanceof TenantResolutionError) {
      return error;
    }

    throw error;
  }
}

describe('tenant-resolver', () => {
  beforeEach(() => {
    descopeSdkMock.client.mockClear();
    descopeSdkMock.validateSession.mockReset();
    descopeSdkMock.configs.splice(0);
  });

  it('resolves tenant context when the verified JWT has a current Descope tenant claim', () => {
    // Given
    const session: VerifiedDescopeSession = {
      token: 'session.jwt',
      claims: {
        sub: 'U2descope2user2id222222222',
        dct: 'T1descope1tenant1id1111111',
        roles: ['reviewer'],
      },
    };

    // When
    const context = resolveTenantContext(session);

    // Then
    expect(context).toEqual({
      tenantId: 'T1descope1tenant1id1111111',
      userId: 'U2descope2user2id222222222',
      roles: ['reviewer'],
    });
  });

  it('resolves tenant context when the verified JWT has a tenant_id custom claim', () => {
    // Given
    const session: VerifiedDescopeSession = {
      token: 'session.jwt',
      claims: {
        sub: 'U2descope2user2id222222222',
        tenant_id: 'T1descope1tenant1id1111111',
      },
    };

    // When
    const context = resolveTenantContext(session);

    // Then
    expect(context).toEqual({
      tenantId: 'T1descope1tenant1id1111111',
      userId: 'U2descope2user2id222222222',
      roles: [],
    });
  });

  it('denies access when the verified JWT has no tenant claim', () => {
    // Given
    const session: VerifiedDescopeSession = {
      token: 'session.jwt',
      claims: {
        sub: 'U2descope2user2id222222222',
      },
    };

    // When / Then
    const error = captureTenantResolutionError(() => resolveTenantContext(session));

    expect(error).toMatchObject({ code: 'missing_tenant' });
  });

  it('denies access when tenant claims disagree', () => {
    // Given
    const session: VerifiedDescopeSession = {
      token: 'session.jwt',
      claims: {
        sub: 'U2descope2user2id222222222',
        dct: 'T1descope1tenant1id1111111',
        tenant_id: 'T3descope3tenant3id3333333',
      },
    };

    // When / Then
    const error = captureTenantResolutionError(() => resolveTenantContext(session));

    expect(error).toMatchObject({ code: 'ambiguous_tenant' });
  });

  it('verifies a bearer token before tenant resolution', async () => {
    // Given
    const seenTokens: string[] = [];
    const session: VerifiedDescopeSession = {
      token: 'session.jwt',
      claims: {
        sub: 'U2descope2user2id222222222',
        dct: 'T1descope1tenant1id1111111',
      },
    };
    const verifier: DescopeSessionVerifier = {
      verifySessionToken: async (sessionToken) => {
        seenTokens.push(sessionToken);
        return session;
      },
    };

    // When
    const verifiedSession = await verifyBearerSession('Bearer session.jwt', verifier);
    const context = resolveTenantContext(verifiedSession);

    // Then
    expect(seenTokens).toEqual(['session.jwt']);
    expect(context.tenantId).toBe('T1descope1tenant1id1111111');
  });

  it('resolves tenant context from the authorization header after Descope verification', async () => {
    // Given
    const verifier: DescopeSessionVerifier = {
      verifySessionToken: async (sessionToken) => ({
        token: sessionToken,
        claims: {
          sub: 'U2descope2user2id222222222',
          dct: 'T1descope1tenant1id1111111',
          roles: ['reviewer'],
        },
      }),
    };

    // When
    const context = await resolveTenantContextFromAuthorization('Bearer session.jwt', verifier);

    // Then
    expect(context).toEqual({
      tenantId: 'T1descope1tenant1id1111111',
      userId: 'U2descope2user2id222222222',
      roles: ['reviewer'],
    });
  });

  it('wraps the Descope SDK session validator behind the verifier boundary', async () => {
    // Given
    let observedSessionToken = '';
    let observedAudience: string | readonly string[] | undefined;
    const client: DescopeSdkClient = {
      validateSession: async (sessionToken, options) => {
        observedSessionToken = sessionToken;
        observedAudience = options?.audience;
        return {
          jwt: sessionToken,
          token: {
            sub: 'U2descope2user2id222222222',
            dct: 'T1descope1tenant1id1111111',
          },
        };
      },
    };
    const verifier = createDescopeSdkSessionVerifier(client, { audience: 'api' });

    // When
    const session = await verifier.verifySessionToken('session.jwt');

    // Then
    expect(observedSessionToken).toBe('session.jwt');
    expect(observedAudience).toBe('api');
    expect(session.claims.dct).toBe('T1descope1tenant1id1111111');
  });

  it('creates a Descope session verifier from project configuration with the SDK mocked at the boundary', async () => {
    // Given
    descopeSdkMock.validateSession.mockResolvedValue({
      jwt: 'session.jwt',
      token: {
        sub: 'U2descope2user2id222222222',
        dct: 'T1descope1tenant1id1111111',
      },
    });
    const config = {
      projectId: 'project-id',
      baseUrl: 'https://api.descope.example',
      publicKey: '{"kty":"RSA"}',
      audience: ['api', 'worker'],
    };

    // When
    const verifier = createDescopeSessionVerifier(config);
    const session = await verifier.verifySessionToken('session.jwt');

    // Then
    expect(descopeSdkMock.configs).toEqual([
      {
        projectId: 'project-id',
        baseUrl: 'https://api.descope.example',
        publicKey: '{"kty":"RSA"}',
      },
    ]);
    expect(descopeSdkMock.validateSession).toHaveBeenCalledWith('session.jwt', {
      audience: ['api', 'worker'],
    });
    expect(session.claims.dct).toBe('T1descope1tenant1id1111111');
  });

  it('denies access when the Descope SDK returns malformed JWT claims', async () => {
    // Given
    const client: DescopeSdkClient = {
      validateSession: async (sessionToken) => ({
        jwt: sessionToken,
        token: {
          dct: 'T1descope1tenant1id1111111',
        },
      }),
    };
    const verifier = createDescopeSdkSessionVerifier(client);

    // When / Then
    await expect(verifier.verifySessionToken('session.jwt')).rejects.toMatchObject({
      code: 'invalid_session',
    });
  });

  it('denies access before verification when the bearer token is missing', async () => {
    // Given
    const seenTokens: string[] = [];
    const verifier: DescopeSessionVerifier = {
      verifySessionToken: async (sessionToken) => {
        seenTokens.push(sessionToken);
        return {
          token: sessionToken,
          claims: {
            sub: 'U2descope2user2id222222222',
            dct: 'T1descope1tenant1id1111111',
          },
        };
      },
    };

    // When / Then
    await expect(verifyBearerSession(undefined, verifier)).rejects.toThrow(SessionVerificationError);
    await expect(verifyBearerSession(undefined, verifier)).rejects.toMatchObject({
      code: 'missing_bearer',
    });
    expect(seenTokens).toEqual([]);
  });
});
