/**
 * DLP (Data Loss Prevention) Security Layer
 * Scans messages for sensitive data and applies configurable policies
 */
import { Scanner, redact, type Finding, type ScannerConfig } from '@nacho-labs/nachos-dlp'
import { randomUUID } from 'node:crypto'
import type { AuditLogger } from '../audit/logger.js'

/**
 * DLP action to take when sensitive data is detected
 */
export type DLPAction = 'allow' | 'block' | 'redact' | 'alert'

/**
 * DLP policy configuration
 */
export interface DLPPolicy {
  /** Action to take when secrets are detected */
  action: DLPAction
  /** Minimum confidence threshold (0-1) to trigger policy */
  minConfidence?: number
  /** Severity levels that trigger this policy */
  severities?: Array<'critical' | 'high' | 'medium' | 'low'>
  /** Pattern categories to check (e.g., 'api-keys', 'pii') */
  categories?: string[]
  /** Specific pattern IDs to check */
  patterns?: string[]
  /** Pattern IDs to exclude from scanning */
  exclude?: string[]
  /** Log findings to audit system */
  logFindings?: boolean
}

/**
 * Channel-specific DLP configuration
 */
export interface ChannelDLPConfig {
  /** Channel ID or pattern */
  channelId: string
  /** Whether this is a secure channel that can contain secrets */
  isSecure: boolean
  /** Override global DLP policy for this channel */
  policy?: DLPPolicy
}

/**
 * DLP scanner configuration
 */
export interface DLPConfig {
  /** Enable DLP scanning */
  enabled: boolean
  /** Global DLP policy */
  globalPolicy: DLPPolicy
  /** Channel-specific configurations */
  channels?: ChannelDLPConfig[]
  /** Custom pattern files to load */
  customPatternFiles?: string[]
  /** Scanner configuration options */
  scannerConfig?: Omit<ScannerConfig, 'customPatternFiles'>
}

/**
 * DLP scan result
 */
export interface DLPScanResult {
  /** Whether the message should be allowed */
  allowed: boolean
  /** Action taken */
  action: DLPAction
  /** Findings detected */
  findings: Finding[]
  /** Modified message (if redacted) */
  message?: string
  /** Reason for blocking/alerting */
  reason?: string
}

/**
 * DLP Security Layer
 * Embeddable scanner for Gateway security (Salsa pattern)
 */
export class DLPSecurityLayer {
  private scanner: Scanner
  private config: DLPConfig
  private channelConfigs: Map<string, ChannelDLPConfig>
  private auditLogger?: AuditLogger

  constructor(config: DLPConfig, auditLogger?: AuditLogger) {
    this.config = config
    this.auditLogger = auditLogger
    this.channelConfigs = new Map()

    // Build channel configuration map
    if (config.channels) {
      for (const channelConfig of config.channels) {
        this.channelConfigs.set(channelConfig.channelId, channelConfig)
      }
    }

    // Initialize scanner with configuration
    const scannerConfig: ScannerConfig = {
      ...config.scannerConfig,
      customPatternFiles: config.customPatternFiles,
      minConfidence: config.globalPolicy.minConfidence ?? 0.6,
    }

    // Apply category/pattern filters from global policy
    if (config.globalPolicy.categories) {
      scannerConfig.patterns = config.globalPolicy.categories
    }
    if (config.globalPolicy.patterns) {
      scannerConfig.patterns = config.globalPolicy.patterns
    }
    if (config.globalPolicy.exclude) {
      scannerConfig.exclude = config.globalPolicy.exclude
    }

    this.scanner = new Scanner(scannerConfig)
  }

  /**
   * Scan a message for sensitive data
   * @param message - Message content to scan
   * @param channelId - Channel ID for channel-specific policies
   * @returns Scan result with action and findings
   */
  scan(message: string, channelId?: string): DLPScanResult {
    if (!this.config.enabled) {
      return {
        allowed: true,
        action: 'allow',
        findings: [],
      }
    }

    // Check if this is a secure channel
    const channelConfig = channelId ? this.channelConfigs.get(channelId) : undefined
    if (channelConfig?.isSecure) {
      // Secure channels can contain secrets - skip DLP scanning
      return {
        allowed: true,
        action: 'allow',
        findings: [],
        reason: 'Secure channel - DLP scanning bypassed',
      }
    }

    // Get applicable policy (channel-specific or global)
    const policy = channelConfig?.policy ?? this.config.globalPolicy

    // Scan the message
    const findings = this.scanner.scan(message)

    // Filter findings by severity if specified in policy
    const relevantFindings = policy.severities
      ? findings.filter((f) => policy.severities!.includes(f.severity as any))
      : findings

    // No findings - allow message
    if (relevantFindings.length === 0) {
      return {
        allowed: true,
        action: 'allow',
        findings: [],
      }
    }

    // Log findings if enabled
    if (policy.logFindings) {
      this.logFindings(relevantFindings, channelId)
    }

    // Apply policy action
    const action = policy.action

    switch (action) {
      case 'allow':
        return {
          allowed: true,
          action: 'allow',
          findings: relevantFindings,
        }

      case 'block':
        return {
          allowed: false,
          action: 'block',
          findings: relevantFindings,
          reason: `Message blocked: ${relevantFindings.length} sensitive data pattern(s) detected`,
        }

      case 'redact': {
        const redactedMessage = redact(message, relevantFindings)
        return {
          allowed: true,
          action: 'redact',
          findings: relevantFindings,
          message: redactedMessage,
        }
      }

      case 'alert':
        return {
          allowed: true,
          action: 'alert',
          findings: relevantFindings,
          reason: `Alert: ${relevantFindings.length} sensitive data pattern(s) detected`,
        }

      default:
        // Default to block for unknown actions
        return {
          allowed: false,
          action: 'block',
          findings: relevantFindings,
          reason: 'Unknown DLP action',
        }
    }
  }

  /**
   * Register a channel as secure (can contain secrets)
   * @param channelId - Channel ID to register
   */
  registerSecureChannel(channelId: string): void {
    this.channelConfigs.set(channelId, {
      channelId,
      isSecure: true,
    })
  }

  /**
   * Unregister a secure channel
   * @param channelId - Channel ID to unregister
   */
  unregisterSecureChannel(channelId: string): void {
    this.channelConfigs.delete(channelId)
  }

  /**
   * Check if a channel is secure
   * @param channelId - Channel ID to check
   * @returns Whether the channel is secure
   */
  isSecureChannel(channelId: string): boolean {
    return this.channelConfigs.get(channelId)?.isSecure ?? false
  }

  /**
   * Update DLP policy at runtime
   * @param policy - New policy configuration
   */
  updatePolicy(policy: Partial<DLPPolicy>): void {
    Object.assign(this.config.globalPolicy, policy)
  }

  /**
   * Log findings to audit system
   * @param findings - DLP findings to log
   * @param channelId - Channel ID where findings were detected
   */
  private logFindings(findings: Finding[], channelId?: string): void {
    if (!this.auditLogger) {
      console.warn('[DLP]', {
        timestamp: new Date().toISOString(),
        channelId,
        findingsCount: findings.length,
        severities: findings.map((f) => f.severity),
        patternIds: findings.map((f) => f.patternId),
      })
      return
    }

    const timestamp = new Date().toISOString()
    const uniqueId = randomUUID()
    void this.auditLogger.log({
      id: `dlp-${timestamp}-${uniqueId}`,
      timestamp,
      instanceId: 'gateway',
      userId: 'unknown',
      sessionId: 'unknown',
      channel: channelId ?? 'unknown',
      eventType: 'dlp_scan',
      action: 'dlp.scan',
      outcome: 'allowed',
      securityMode: 'standard',
      details: {
        findingsCount: findings.length,
        severities: findings.map((f) => f.severity),
        patternIds: findings.map((f) => f.patternId),
      },
    })
  }

  /**
   * Get scanner statistics
   */
  getStats(): {
    enabled: boolean
    patternsLoaded: number
    secureChannels: number
  } {
    return {
      enabled: this.config.enabled,
      patternsLoaded: this.scanner.getPatterns().length,
      secureChannels: this.channelConfigs.size,
    }
  }
}

/**
 * Create default DLP configuration
 */
export function createDefaultDLPConfig(): DLPConfig {
  return {
    enabled: true,
    globalPolicy: {
      action: 'alert', // Default to alert mode
      minConfidence: 0.6,
      severities: ['critical', 'high'], // Only check critical and high severity
      logFindings: true,
    },
    channels: [],
  }
}
