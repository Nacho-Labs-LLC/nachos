import { describe, expect, it } from 'vitest';
import { parseTimeoutOption } from './cli.js';

describe('parseTimeoutOption', () => {
  it('accepts undefined timeout', () => {
    expect(parseTimeoutOption(undefined)).toBeUndefined();
  });

  it('accepts valid timeout range', () => {
    expect(parseTimeoutOption('1')).toBe(1);
    expect(parseTimeoutOption('600')).toBe(600);
  });

  it('throws for invalid timeout values', () => {
    expect(() => parseTimeoutOption('0')).toThrow('between 1 and 600');
    expect(() => parseTimeoutOption('-1')).toThrow('between 1 and 600');
    expect(() => parseTimeoutOption('601')).toThrow('between 1 and 600');
    expect(() => parseTimeoutOption('abc')).toThrow('between 1 and 600');
  });
});
