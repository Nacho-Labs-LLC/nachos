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

/**
 * SSRF protection configuration
 */
export interface SSRFProtectionConfig {
  /** Allowed domains (use ['*'] to allow all) */
  allowedDomains: string[];

  /** Block private IP addresses (RFC1918) */
  blockPrivateIPs?: boolean;

  /** Block localhost */
  blockLocalhost?: boolean;

  /** Additional blocked IPs or patterns */
  blockedIPs?: Array<string | RegExp>;
}

/**
 * Private IP ranges (RFC1918)
 */
const PRIVATE_IP_RANGES = [
  /^10\./,                    // 10.0.0.0/8
  /^172\.(1[6-9]|2[0-9]|3[01])\./, // 172.16.0.0/12
  /^192\.168\./,               // 192.168.0.0/16
  /^169\.254\./,               // 169.254.0.0/16 (link-local)
  /^127\./,                    // 127.0.0.0/8 (loopback)
  /^0\./,                      // 0.0.0.0/8
  /^fc00:/i,                   // fc00::/7 (IPv6 unique local)
  /^fe80:/i,                   // fe80::/10 (IPv6 link-local)
  /^::1$/,                     // ::1 (IPv6 loopback)
  /^::$/,                      // :: (IPv6 unspecified)
];

/**
 * SSRF protection validator
 */
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

  /**
   * Validate a URL for SSRF safety
   */
  async validateURL(url: string): Promise<ToolValidationResult> {
    try {
      const parsed = new URL(url);

      // Only allow http/https protocols
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return {
          valid: false,
          errors: [`Protocol '${parsed.protocol}' not allowed. Only http: and https: are supported.`],
        };
      }

      // Check domain allowlist
      const domainCheck = this.checkDomainAllowlist(parsed.hostname);
      if (!domainCheck.valid) {
        return domainCheck;
      }

      // Check if hostname is an IP address
      if (this.isIPAddress(parsed.hostname)) {
        const ipCheck = this.checkIPAddress(parsed.hostname);
        if (!ipCheck.valid) {
          return ipCheck;
        }
      } else {
        // Resolve DNS to check for SSRF via DNS rebinding
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

  /**
   * Check if domain is in allowlist
   */
  private checkDomainAllowlist(hostname: string): ToolValidationResult {
    // If allowlist contains '*', allow all domains
    if (this.allowedDomains.includes('*')) {
      return { valid: true };
    }

    // Normalize hostname
    const normalized = hostname.toLowerCase();

    // Check exact match or subdomain match
    const isAllowed = this.allowedDomains.some((allowed) => {
      const normalizedAllowed = allowed.toLowerCase();
      return (
        normalized === normalizedAllowed ||
        normalized.endsWith(`.${normalizedAllowed}`)
      );
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

  /**
   * Check if IP address is blocked
   */
  private checkIPAddress(ip: string): ToolValidationResult {
    // Check if localhost
    if (this.blockLocalhost && this.isLocalhost(ip)) {
      return {
        valid: false,
        errors: ['Cannot navigate to localhost'],
      };
    }

    // Check if private IP
    if (this.blockPrivateIPs && this.isPrivateIP(ip)) {
      return {
        valid: false,
        errors: [`Cannot navigate to private IP address: ${ip}`],
      };
    }

    // Check custom blocked IPs
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

  /**
   * Resolve DNS and check resolved IPs
   */
  private async checkDNSResolution(hostname: string): Promise<ToolValidationResult> {
    try {
      // Resolve both IPv4 and IPv6
      const results = await Promise.allSettled([
        dns.resolve4(hostname),
        dns.resolve6(hostname),
      ]);

      const ips: string[] = [];

      // Collect resolved IPs
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

      // Check each resolved IP
      for (const ip of ips) {
        const ipCheck = this.checkIPAddress(ip);
        if (!ipCheck.valid) {
          return {
            valid: false,
            errors: [
              `DNS resolution detected forbidden IP: ${ip} for ${hostname}`,
              ...(ipCheck.errors ?? []),
            ],
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

  /**
   * Check if string is an IP address
   */
  private isIPAddress(hostname: string): boolean {
    // IPv4 pattern
    const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
    // IPv6 pattern (simplified)
    const ipv6Pattern = /^[a-fA-F0-9:]+$/;

    return ipv4Pattern.test(hostname) || ipv6Pattern.test(hostname);
  }

  /**
   * Check if IP is localhost
   */
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

  /**
   * Check if IP is in private range
   */
  private isPrivateIP(ip: string): boolean {
    return PRIVATE_IP_RANGES.some((pattern) => pattern.test(ip));
  }

  /**
   * Get allowed domains
   */
  getAllowedDomains(): string[] {
    return [...this.allowedDomains];
  }

  /**
   * Add an allowed domain
   */
  addAllowedDomain(domain: string): void {
    if (!this.allowedDomains.includes(domain)) {
      this.allowedDomains.push(domain);
    }
  }
}
