import { describe, expect, it, vi } from 'vitest';
import { ContextCompactionManager } from './context-compaction-manager.js';

describe('ContextCompactionManager', () => {
  it('returns early when context manager or sessions store is missing', async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    const manager = new ContextCompactionManager({
      bus: { publish },
      componentName: 'gateway',
      securityMode: 'standard',
    });

    await expect(manager.checkAndCompactContext({ sessionId: 's1' })).resolves.toBeUndefined();
    expect(publish).not.toHaveBeenCalled();
  });
});
