import { z } from 'zod';

const SessionTokenSchema = z.string().trim().min(1);

export type AuthorizationHeader = {
  readonly Authorization: string;
};

export class SessionTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionTokenError';
  }
}

export function createAuthorizationHeader(sessionToken: string): AuthorizationHeader {
  const parsedToken = SessionTokenSchema.safeParse(sessionToken);
  if (!parsedToken.success) {
    throw new SessionTokenError('Descope session token is required');
  }

  return { Authorization: `Bearer ${parsedToken.data}` };
}
