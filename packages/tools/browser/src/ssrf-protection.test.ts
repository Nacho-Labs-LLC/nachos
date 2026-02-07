import { beforeEach, describe, expect, it, vi } from 'vitest';
import dns from 'node:dns/promises';
import { SSRFProtection } from './ssrf-protection.js';

vi.mock('node:dns/promises', () => ({
  default: {
    resolve4: vi.fn(),
    resolve6: vi.fn(),
  },
}));

describe('SSRFProtection', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('rejects non-http protocols', async () => {
    const protection = new SSRFProtection({ allowedDomains: ['*'] });
    const result = await protection.validateURL('ftp://example.com');

    expect(result.valid).toBe(false);
    expect(result.errors?.[0]).toContain('Protocol');
  });

  it('rejects disallowed domains', async () => {
    const protection = new SSRFProtection({ allowedDomains: ['example.com'] });
    const result = await protection.validateURL('https://evil.com');

    expect(result.valid).toBe(false);
    expect(result.errors?.[0]).toContain('not in the allowlist');
  });

  it('blocks private IPs', async () => {
    const protection = new SSRFProtection({ allowedDomains: ['*'] });
    const result = await protection.validateURL('http://10.0.0.1');

    expect(result.valid).toBe(false);
    expect(result.errors?.[0]).toContain('private IP');
  });

  it('allows allowed domains with safe DNS resolution', async () => {
    const resolve4Mock = vi.mocked(dns.resolve4);
    const resolve6Mock = vi.mocked(dns.resolve6);

    resolve4Mock.mockResolvedValue(['93.184.216.34']);
    resolve6Mock.mockResolvedValue([]);

    const protection = new SSRFProtection({ allowedDomains: ['example.com'] });
    const result = await protection.validateURL('https://sub.example.com');

    expect(result.valid).toBe(true);
  });

  it('blocks DNS resolution to private IPs', async () => {
    const resolve4Mock = vi.mocked(dns.resolve4);
    const resolve6Mock = vi.mocked(dns.resolve6);

    resolve4Mock.mockResolvedValue(['127.0.0.1']);
    resolve6Mock.mockResolvedValue([]);

    const protection = new SSRFProtection({ allowedDomains: ['example.com'] });
    const result = await protection.validateURL('https://example.com');

    expect(result.valid).toBe(false);
    expect(result.errors?.[0]).toContain('DNS resolution detected forbidden IP');
  });

  it('blocks DNS rebinding to private IPs', async () => {
    const resolve4Mock = vi.mocked(dns.resolve4);
    const resolve6Mock = vi.mocked(dns.resolve6);

    resolve4Mock.mockResolvedValue(['10.0.0.2']);
    resolve6Mock.mockResolvedValue([]);

    const protection = new SSRFProtection({ allowedDomains: ['example.com'] });
    const result = await protection.validateURL('https://example.com');

    expect(result.valid).toBe(false);
    expect(result.errors?.[0]).toContain('DNS resolution detected forbidden IP');
  });

  it('blocks explicitly configured IPs', async () => {
    const protection = new SSRFProtection({
      allowedDomains: ['*'],
      blockedIPs: [/^93\.184\.216\./],
    });

    const result = await protection.validateURL('http://93.184.216.34');

    expect(result.valid).toBe(false);
    expect(result.errors?.[0]).toContain('matches blocked pattern');
  });
});
