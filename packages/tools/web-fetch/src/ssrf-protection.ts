/**
 * SSRF Protection
 *
 * Protects against Server-Side Request Forgery attacks by:
 * - Validating domain allowlists
 * - Blocking private IP addresses
 * - DNS resolution validation
 */

import dns from 'node:dns/promises';
import type { ToolValidationResult } from '@nachos/types';

export interface SSRFProtectionConfig {
  allowedDomains: string[];
  blockPrivateIPs?: boolean;
  blockLocalhost?: boolean;
  blockedIPs?: Array<string | RegExp>;
}

const PRIVATE_IP_RANGES = [
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^127\./,
  /^0\./,
  /^fc00:/i,
  /^fe80:/i,
  /^::1$/,
  /^::$/,
  // IPv4-mapped IPv6 addresses (::ffff:x.x.x.x) — bypass protection without these
  /^::ffff:127\./i, // ::ffff:127.0.0.0/8 (loopback)
  /^::ffff:10\./i, // ::ffff:10.0.0.0/8 (Class A private)
  /^::ffff:172\.(1[6-9]|2[0-9]|3[01])\./i, // ::ffff:172.16.0.0/12 (Class B private)
  /^::ffff:192\.168\./i, // ::ffff:192.168.0.0/16 (Class C private)
  /^::ffff:0\.0\.0\.0$/i, // ::ffff:0.0.0.0 (unspecified)
];

export class SSRFProtection {
  private allowedDomains: string[];
  private blockPrivateIPs: boolean;
  private blockLocalhost: boolean;
  private blockedIPs: Array<string | RegExp>;

  constructor(config: SSRFProtectionConfig) {
    this.allowedDomains = config.allowedDomains;
    this.blockPrivateIPs = config.blockPrivateIPs ?? true;
    this.blockLocalhost = config.blockLocalhost ?? true;
    this.blockedIPs = config.blockedIPs ?? [];
  }

  getAllowedDomains(): string[] {
    return [...this.allowedDomains];
  }

  async validateURL(url: string): Promise<ToolValidationResult> {
    try {
      const parsed = new URL(url);

      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return {
          valid: false,
          errors: [
            `Protocol '${parsed.protocol}' not allowed. Only http: and https: are supported.`,
          ],
        };
      }

      const domainCheck = this.checkDomainAllowlist(parsed.hostname);
      if (!domainCheck.valid) {
        return domainCheck;
      }

      if (this.isIPAddress(parsed.hostname)) {
        const ipCheck = this.checkIPAddress(parsed.hostname);
        if (!ipCheck.valid) {
          return ipCheck;
        }
      } else {
        const dnsCheck = await this.checkDNSResolution(parsed.hostname);
        if (!dnsCheck.valid) {
          return dnsCheck;
        }
      }

      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        errors: [`Invalid URL: ${error instanceof Error ? error.message : 'Unknown error'}`],
      };
    }
  }

  private checkDomainAllowlist(hostname: string): ToolValidationResult {
    if (this.allowedDomains.includes('*')) {
      return { valid: true };
    }

    const normalized = hostname.toLowerCase();
    const isAllowed = this.allowedDomains.some((allowed) => {
      const normalizedAllowed = allowed.toLowerCase();
      return normalized === normalizedAllowed || normalized.endsWith(`.${normalizedAllowed}`);
    });

    if (!isAllowed) {
      return {
        valid: false,
        errors: [
          `Domain '${hostname}' is not in the allowlist. Allowed domains: ${this.allowedDomains.join(', ')}`,
        ],
      };
    }

    return { valid: true };
  }

  private checkIPAddress(ip: string): ToolValidationResult {
    if (this.blockLocalhost && this.isLocalhost(ip)) {
      return {
        valid: false,
        errors: ['Cannot fetch localhost'],
      };
    }

    if (this.blockPrivateIPs && this.isPrivateIP(ip)) {
      return {
        valid: false,
        errors: [`Cannot fetch private IP address: ${ip}`],
      };
    }

    for (const blocked of this.blockedIPs) {
      if (typeof blocked === 'string') {
        if (ip === blocked) {
          return {
            valid: false,
            errors: [`IP address '${ip}' is blocked`],
          };
        }
      } else if (blocked.test(ip)) {
        return {
          valid: false,
          errors: [`IP address '${ip}' matches blocked pattern`],
        };
      }
    }

    return { valid: true };
  }

  private async checkDNSResolution(hostname: string): Promise<ToolValidationResult> {
    try {
      const results = await Promise.allSettled([dns.resolve4(hostname), dns.resolve6(hostname)]);

      const ips: string[] = [];
      for (const result of results) {
        if (result.status === 'fulfilled') {
          ips.push(...result.value);
        }
      }

      if (ips.length === 0) {
        return {
          valid: false,
          errors: [`Could not resolve hostname: ${hostname}`],
        };
      }

      for (const ip of ips) {
        const ipCheck = this.checkIPAddress(ip);
        if (!ipCheck.valid) {
          return {
            valid: false,
            errors: [`DNS resolution detected forbidden IP: ${ip} for ${hostname}`],
          };
        }
      }

      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        errors: [
          `DNS resolution failed for ${hostname}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ],
      };
    }
  }

  private isIPAddress(hostname: string): boolean {
    const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
    const ipv6Pattern = /^[a-fA-F0-9:]+$/;

    return ipv4Pattern.test(hostname) || ipv6Pattern.test(hostname);
  }

  private isLocalhost(ip: string): boolean {
    return (
      ip === 'localhost' ||
      ip === '127.0.0.1' ||
      ip.startsWith('127.') ||
      ip === '::1' ||
      ip === '0.0.0.0' ||
      ip === '::'
    );
  }

  private isPrivateIP(ip: string): boolean {
    return PRIVATE_IP_RANGES.some((pattern) => pattern.test(ip));
  }
}
