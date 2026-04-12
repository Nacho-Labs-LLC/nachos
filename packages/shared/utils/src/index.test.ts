import { describe, it, expect } from 'vitest';
import { noop } from './index.js';

describe('utils', () => {
  it('should have a noop function', () => {
    expect(noop).toBeDefined();
    expect(typeof noop).toBe('function');
  });

  it('noop should return undefined', () => {
    expect(noop()).toBeUndefined();
  });
});
