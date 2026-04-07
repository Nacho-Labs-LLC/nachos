import { describe, expect, it } from 'vitest';
import {
  getContextManagementOverride,
  isContextManagementEnabledForSession,
  parseContextCommand,
  resolveContextCommandConfig,
} from './context-commands.js';

describe('context-commands', () => {
  it('resolves default config', () => {
    const config = resolveContextCommandConfig(undefined);
    expect(config.enabled).toBe(true);
    expect(config.resetTriggers).toContain('/reset');
  });

  it('parses /context commands with remainder', () => {
    const config = resolveContextCommandConfig(undefined);
    expect(parseContextCommand('/context off', config)).toEqual({
      type: 'context',
      trigger: '/context',
      remainder: 'off',
    });
  });

  it('reads context management overrides from session metadata', () => {
    const session = {
      metadata: {
        contextManagement: {
          enabled: false,
        },
      },
    };
    expect(getContextManagementOverride(session as never)).toBe(false);
    expect(isContextManagementEnabledForSession(session as never)).toBe(false);
  });
});
