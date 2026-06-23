// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import { getToken } from './token.js';

const clearCookies = (): void => {
  document.cookie = 'DS=; Max-Age=0; path=/';
  document.cookie = 'ds=; Max-Age=0; path=/';
};

const setCookie = (name: 'DS' | 'ds', value: string): void => {
  document.cookie = `${name}=${value}; path=/`;
};

describe('getToken', () => {
  beforeEach(() => {
    clearCookies();
  });

  it('returns DS when only DS exists', () => {
    setCookie('DS', 'real-session');

    expect(getToken()).toBe('real-session');
  });

  it('returns ds when only ds exists', () => {
    setCookie('ds', 'legacy-session');

    expect(getToken()).toBe('legacy-session');
  });

  it('prefers DS when both cookies exist', () => {
    setCookie('ds', 'legacy-session');
    setCookie('DS', 'real-session');

    expect(getToken()).toBe('real-session');
  });

  it('returns empty string when no cookie exists', () => {
    expect(getToken()).toBe('');
  });

  it('decodes URL-encoded values', () => {
    setCookie('DS', 'hello%20world');

    expect(getToken()).toBe('hello world');
  });
});
