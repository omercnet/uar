import { describe, it, expect } from 'vitest';
import { PACKAGE_NAME } from './index.js';

describe('@uar/connectors smoke', () => {
  it('exports the package name', () => {
    expect(PACKAGE_NAME).toBe('@uar/connectors');
  });
});
