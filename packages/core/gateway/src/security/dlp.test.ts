import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DLPSecurityLayer, createDefaultDLPConfig, type DLPConfig } from './dlp.js';
import type { AuditLogger } from '../audit/logger.js';

describe('DLPSecurityLayer', () => {
  let dlp: DLPSecurityLayer;

  beforeEach(() => {
    const config = createDefaultDLPConfig();
    dlp = new DLPSecurityLayer(config);
  });

  describe('Basic Scanning', () => {
    it('should detect AWS access keys', () => {
      const message = 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE';
      const result = dlp.scan(message);

      expect(result.findings.length).toBeGreaterThan(0);
      expect(result.findings.some((f) => f.patternId === 'aws-access-key-id')).toBe(true);
    });

    it('should detect GitHub tokens', () => {
      const message = 'export GITHUB_TOKEN=ghp_1234567890abcdefghijklmnopqrstuvwxyz';
      const result = dlp.scan(message);

      expect(result.findings.length).toBeGreaterThan(0);
      expect(result.findings.some((f) => f.patternId === 'github-pat')).toBe(true);
    });

    it('should detect OpenAI keys', () => {
      const message = 'OPENAI_API_KEY=sk-1234567890abcdefghijklmnopqrstuvwxyz1234567890';
      const result = dlp.scan(message);

      expect(result.findings.length).toBeGreaterThan(0);
      expect(result.findings.some((f) => f.severity === 'critical')).toBe(true);
    });

    it('should not detect secrets in clean messages', () => {
      const message = 'Hello, this is a normal message without any secrets';
      const result = dlp.scan(message);

      expect(result.findings).toHaveLength(0);
      expect(result.allowed).toBe(true);
    });
  });

  describe('Policy Actions', () => {
    it('should allow messages when policy is allow', () => {
      const config: DLPConfig = {
        enabled: true,
        globalPolicy: {
          action: 'allow',
          minConfidence: 0.6,
        },
      };
      dlp = new DLPSecurityLayer(config);

      const message = 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE';
      const result = dlp.scan(message);

      expect(result.allowed).toBe(true);
      expect(result.action).toBe('allow');
      expect(result.findings.length).toBeGreaterThan(0);
    });

    it('should block messages when policy is block', () => {
      const config: DLPConfig = {
        enabled: true,
        globalPolicy: {
          action: 'block',
          minConfidence: 0.6,
        },
      };
      dlp = new DLPSecurityLayer(config);

      const message = 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE';
      const result = dlp.scan(message);

      expect(result.allowed).toBe(false);
      expect(result.action).toBe('block');
      expect(result.reason).toContain('blocked');
    });

    it('should redact messages when policy is redact', () => {
      const config: DLPConfig = {
        enabled: true,
        globalPolicy: {
          action: 'redact',
          minConfidence: 0.6,
        },
      };
      dlp = new DLPSecurityLayer(config);

      const message = 'My AWS key is AKIAIOSFODNN7EXAMPLE';
      const result = dlp.scan(message);

      expect(result.allowed).toBe(true);
      expect(result.action).toBe('redact');
      expect(result.message).toBeDefined();
      expect(result.message).toContain('[REDACTED]');
      expect(result.message).not.toContain('AKIAIOSFODNN7EXAMPLE');
    });

    it('should alert on messages when policy is alert', () => {
      const config: DLPConfig = {
        enabled: true,
        globalPolicy: {
          action: 'alert',
          minConfidence: 0.6,
          logFindings: false,
        },
      };
      dlp = new DLPSecurityLayer(config);

      const message = 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE';
      const result = dlp.scan(message);

      expect(result.allowed).toBe(true);
      expect(result.action).toBe('alert');
      expect(result.reason).toContain('Alert');
    });
  });

  describe('Secure Channels', () => {
    it('should bypass DLP scanning for secure channels', () => {
      const config: DLPConfig = {
        enabled: true,
        globalPolicy: {
          action: 'block',
          minConfidence: 0.6,
        },
        channels: [
          {
            channelId: 'dm-secure-123',
            isSecure: true,
          },
        ],
      };
      dlp = new DLPSecurityLayer(config);

      const message = 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE';
      const result = dlp.scan(message, 'dm-secure-123');

      expect(result.allowed).toBe(true);
      expect(result.action).toBe('allow');
      expect(result.findings).toHaveLength(0);
      expect(result.reason).toContain('Secure channel');
    });

    it('should scan non-secure channels normally', () => {
      const config: DLPConfig = {
        enabled: true,
        globalPolicy: {
          action: 'block',
          minConfidence: 0.6,
        },
        channels: [
          {
            channelId: 'dm-secure-123',
            isSecure: true,
          },
        ],
      };
      dlp = new DLPSecurityLayer(config);

      const message = 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE';
      const result = dlp.scan(message, 'public-channel');

      expect(result.allowed).toBe(false);
      expect(result.action).toBe('block');
    });

    it('should register secure channels dynamically', () => {
      dlp.registerSecureChannel('new-dm-channel');
      expect(dlp.isSecureChannel('new-dm-channel')).toBe(true);

      const message = 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE';
      const config: DLPConfig = {
        enabled: true,
        globalPolicy: {
          action: 'block',
        },
      };
      dlp = new DLPSecurityLayer(config);
      dlp.registerSecureChannel('new-dm-channel');

      const result = dlp.scan(message, 'new-dm-channel');
      expect(result.allowed).toBe(true);
    });

    it('should unregister secure channels', () => {
      dlp.registerSecureChannel('temp-channel');
      expect(dlp.isSecureChannel('temp-channel')).toBe(true);

      dlp.unregisterSecureChannel('temp-channel');
      expect(dlp.isSecureChannel('temp-channel')).toBe(false);
    });
  });

  describe('Channel-Specific Policies', () => {
    it('should apply channel-specific policy over global policy', () => {
      const config: DLPConfig = {
        enabled: true,
        globalPolicy: {
          action: 'block',
          minConfidence: 0.6,
        },
        channels: [
          {
            channelId: 'lenient-channel',
            isSecure: false,
            policy: {
              action: 'alert',
              minConfidence: 0.8,
            },
          },
        ],
      };
      dlp = new DLPSecurityLayer(config);

      const message = 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE';
      const result = dlp.scan(message, 'lenient-channel');

      expect(result.allowed).toBe(true);
      expect(result.action).toBe('alert');
    });
  });

  describe('Severity Filtering', () => {
    it('should only detect critical and high severity by default', () => {
      const message = 'Email: user@example.com and AWS_KEY=AKIAIOSFODNN7EXAMPLE';
      const result = dlp.scan(message);

      // Should detect AWS key (critical) but not email (low)
      expect(result.findings.some((f) => f.patternId === 'aws-access-key-id')).toBe(true);
      expect(result.findings.some((f) => f.patternId === 'email-address')).toBe(false);
    });

    it('should respect custom severity filters', () => {
      const config: DLPConfig = {
        enabled: true,
        globalPolicy: {
          action: 'alert',
          severities: ['low'],
          minConfidence: 0.1,
        },
      };
      dlp = new DLPSecurityLayer(config);

      const message = 'Email: user@example.com';
      const result = dlp.scan(message);

      // Should only detect email (low), not AWS key (critical)
      const criticalFindings = result.findings.filter((f) => f.severity === 'critical');

      expect(result.findings.some((f) => f.severity === 'critical')).toBe(false);
      expect(criticalFindings).toHaveLength(0);
    });
  });

  describe('Disabled DLP', () => {
    it('should allow all messages when DLP is disabled', () => {
      const config: DLPConfig = {
        enabled: false,
        globalPolicy: {
          action: 'block',
        },
      };
      dlp = new DLPSecurityLayer(config);

      const message = 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE';
      const result = dlp.scan(message);

      expect(result.allowed).toBe(true);
      expect(result.action).toBe('allow');
      expect(result.findings).toHaveLength(0);
    });
  });

  describe('Stats', () => {
    it('should return scanner statistics', () => {
      const stats = dlp.getStats();

      expect(stats.enabled).toBe(true);
      expect(stats.patternsLoaded).toBeGreaterThan(0);
      expect(stats.secureChannels).toBe(0);
    });

    it('should count secure channels', () => {
      dlp.registerSecureChannel('ch1');
      dlp.registerSecureChannel('ch2');

      const stats = dlp.getStats();
      expect(stats.secureChannels).toBe(2);
    });
  });

  describe('Policy Updates', () => {
    it('should update policy at runtime', () => {
      dlp.updatePolicy({ action: 'block' });

      const message = 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE';
      const result = dlp.scan(message);

      expect(result.action).toBe('block');
      expect(result.allowed).toBe(false);
    });
  });

  it('should log findings to audit logger when configured', () => {
    const config: DLPConfig = {
      enabled: true,
      globalPolicy: {
        action: 'alert',
        minConfidence: 0.6,
        logFindings: true,
      },
    };
    const auditLogger = { log: vi.fn().mockResolvedValue(undefined) } as unknown as AuditLogger;
    dlp = new DLPSecurityLayer(config, auditLogger);

    const message = 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE';
    dlp.scan(message);

    expect(auditLogger.log).toHaveBeenCalledTimes(1);
  });
});
