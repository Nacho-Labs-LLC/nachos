import { describe, expect, it } from 'vitest';
import { loadAuditProvider } from './loader.js';
import { FileAuditProvider } from './providers/file.js';
import { CompositeAuditProvider } from './providers/composite.js';

describe('loadAuditProvider', () => {
  it('should load file provider', async () => {
    const provider = await loadAuditProvider({
      enabled: true,
      provider: 'file',
      path: './audit.log',
    });

    expect(provider).toBeInstanceOf(FileAuditProvider);
  });

  it('should load composite provider', async () => {
    const provider = await loadAuditProvider({
      enabled: true,
      providers: ['file', 'sqlite'],
      path: './audit.db',
    });

    expect(provider).toBeInstanceOf(CompositeAuditProvider);
  });

  it('should load file provider with flush interval', async () => {
    const provider = await loadAuditProvider({
      enabled: true,
      provider: 'file',
      path: './audit.log',
      flush_interval_ms: 1234,
    });

    expect(provider).toBeInstanceOf(FileAuditProvider);
  });

  it('should reject composite provider containing itself', async () => {
    await expect(
      loadAuditProvider({
        enabled: true,
        provider: 'composite',
        providers: ['composite'],
      })
    ).rejects.toThrow('Composite audit provider cannot include itself');
  });
});
