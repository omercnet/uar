import DescopeClient, { type AuthenticationInfo, type VerifyOptions } from '@descope/node-sdk';
import { z } from 'zod';

const NonEmptyStringSchema = z.string().trim().min(1);

const BearerTokenSchema = NonEmptyStringSchema.regex(/^Bearer \S+$/);

export const DescopeSessionClaimsSchema = z
  .object({
    sub: NonEmptyStringSchema,
    dct: NonEmptyStringSchema.optional(),
    tenant_id: NonEmptyStringSchema.optional(),
    roles: z.array(NonEmptyStringSchema).optional(),
  })
  .passthrough();

const AuthenticationInfoSchema = z
  .object({
    token: DescopeSessionClaimsSchema,
  })
  .passthrough();

export const SessionVerificationErrorCodes = {
  missingBearer: 'missing_bearer',
  invalidBearer: 'invalid_bearer',
  invalidSession: 'invalid_session',
} as const;

export type SessionVerificationErrorCode =
  (typeof SessionVerificationErrorCodes)[keyof typeof SessionVerificationErrorCodes];

export type DescopeSessionClaims = z.infer<typeof DescopeSessionClaimsSchema>;

export type VerifiedDescopeSession = {
  readonly token: string;
  readonly claims: DescopeSessionClaims;
};

export interface DescopeSessionVerifier {
  readonly verifySessionToken: (sessionToken: string) => Promise<VerifiedDescopeSession>;
}

export interface DescopeSdkClient {
  readonly validateSession: (
    sessionToken: string,
    options?: VerifyOptions,
  ) => Promise<AuthenticationInfo>;
}

export const DescopeSessionVerifierConfigSchema = z.object({
  projectId: NonEmptyStringSchema,
  baseUrl: NonEmptyStringSchema.optional(),
  publicKey: NonEmptyStringSchema.optional(),
  audience: z.union([NonEmptyStringSchema, z.array(NonEmptyStringSchema).min(1)]).optional(),
});

export type DescopeSessionVerifierConfig = z.infer<typeof DescopeSessionVerifierConfigSchema>;

export class SessionVerificationError extends Error {
  readonly code: SessionVerificationErrorCode;

  constructor(code: SessionVerificationErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SessionVerificationError';
    this.code = code;
  }
}

export function createDescopeSessionVerifier(
  config: DescopeSessionVerifierConfig,
): DescopeSessionVerifier {
  const parsedConfig = DescopeSessionVerifierConfigSchema.parse(config);
  const client = DescopeClient({
    projectId: parsedConfig.projectId,
    baseUrl: parsedConfig.baseUrl,
    publicKey: parsedConfig.publicKey,
  });
  const verifyOptions =
    parsedConfig.audience === undefined ? undefined : { audience: parsedConfig.audience };

  return createDescopeSdkSessionVerifier(client, verifyOptions);
}

export function createDescopeSdkSessionVerifier(
  client: DescopeSdkClient,
  verifyOptions?: VerifyOptions,
): DescopeSessionVerifier {
  return {
    verifySessionToken: async (sessionToken) => {
      try {
        const authInfo = await client.validateSession(sessionToken, verifyOptions);
        return parseAuthenticationInfo(sessionToken, authInfo);
      } catch (error) {
        if (error instanceof SessionVerificationError) {
          throw error;
        }

        throw new SessionVerificationError(
          SessionVerificationErrorCodes.invalidSession,
          'Descope session verification failed',
          { cause: error },
        );
      }
    },
  };
}

export async function verifyBearerSession(
  authorizationHeader: string | undefined,
  verifier: DescopeSessionVerifier,
): Promise<VerifiedDescopeSession> {
  const sessionToken = parseBearerToken(authorizationHeader);

  return verifier.verifySessionToken(sessionToken);
}

function parseBearerToken(authorizationHeader: string | undefined): string {
  if (authorizationHeader === undefined) {
    throw new SessionVerificationError(
      SessionVerificationErrorCodes.missingBearer,
      'Authorization bearer token is required',
    );
  }

  const parsedHeader = BearerTokenSchema.safeParse(authorizationHeader);
  if (!parsedHeader.success) {
    throw new SessionVerificationError(
      SessionVerificationErrorCodes.invalidBearer,
      'Authorization header must use Bearer token format',
    );
  }

  const [, sessionToken] = parsedHeader.data.split(' ');
  if (sessionToken === undefined) {
    throw new SessionVerificationError(
      SessionVerificationErrorCodes.invalidBearer,
      'Authorization header must include a session token',
    );
  }

  return sessionToken;
}

function parseAuthenticationInfo(
  sessionToken: string,
  authInfo: AuthenticationInfo,
): VerifiedDescopeSession {
  const parsedInfo = AuthenticationInfoSchema.safeParse(authInfo);
  if (!parsedInfo.success) {
    throw new SessionVerificationError(
      SessionVerificationErrorCodes.invalidSession,
      'Descope session payload is missing required JWT claims',
      { cause: parsedInfo.error },
    );
  }

  return {
    token: sessionToken,
    claims: parsedInfo.data.token,
  };
}
