import { describe, expect, it } from 'vitest';

import { createAuthorizationHeader, SessionTokenError } from './session.js';

describe('web auth session helpers', () => {
  it('builds the API authorization header from a Descope session token', () => {
    // Given
    const sessionToken = 'session.jwt';

    // When
    const header = createAuthorizationHeader(sessionToken);

    // Then
    expect(header).toEqual({ Authorization: 'Bearer session.jwt' });
  });

  it('rejects an empty Descope session token before building a header', () => {
    // Given
    const sessionToken = '';

    // When / Then
    expect(() => createAuthorizationHeader(sessionToken)).toThrow(SessionTokenError);
  });
});
