import { describe, it, expect } from 'vitest';
import { PACKAGE_NAME } from './index.js';

describe('@uar/reporting smoke', () => {
  it('exports the package name', () => {
    expect(PACKAGE_NAME).toBe('@uar/reporting');
  });
});
