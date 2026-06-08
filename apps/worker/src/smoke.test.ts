import { describe, it, expect } from 'vitest';
import { APP_NAME } from './index.js';

describe('@uar/worker smoke', () => {
  it('exports the app name', () => {
    expect(APP_NAME).toBe('@uar/worker');
  });
});
