import { describe, it, expect } from 'vitest';
import { APP_NAME } from './index.js';

describe('@uar/web smoke', () => {
  it('exports the app name', () => {
    expect(APP_NAME).toBe('@uar/web');
  });
});
