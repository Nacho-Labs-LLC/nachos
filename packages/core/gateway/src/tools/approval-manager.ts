/**
 * Tool Approval Manager
 *
 * Hybrid approval system combining Salsa policy checks with user approval:
 * 1. Salsa policy check (fast, automated)
 * 2. User approval for SecurityTier >= 3 (RESTRICTED)
 *
 * Approval flow:
 * - Publish approval request to channel
 * - Wait for /approve {id} response (2-minute timeout)
 * - Execute if approved, deny if timeout or rejected
 */

import type { ToolCall, SecurityTier } from '@nachos/types';
import { EventEmitter } from 'events';

/**
 * Approval request
 */
export interface ApprovalRequest {
  /** Unique request ID */
  id: string;

  /** Tool being called */
  toolCall: ToolCall;

  /** Security tier of the tool */
  securityTier: SecurityTier;

  /** Timestamp when request was created */
  createdAt: Date;

  /** Session ID */
  sessionId: string;
}

/**
 * Approval result
 */
export interface ApprovalResult {
  /** Whether the request was approved */
  approved: boolean;

  /** Reason for denial (if not approved) */
  reason?: string;

  /** User who approved/denied (if applicable) */
  userId?: string;
}

/**
 * Approval manager for restricted tools
 */
export class ApprovalManager extends EventEmitter {
  private pendingRequests = new Map<string, ApprovalRequest>();
  private approvalTimeoutMs: number;

  constructor(approvalTimeoutMs: number = 120000) {
    super();
    this.approvalTimeoutMs = approvalTimeoutMs; // Default: 2 minutes
  }

  /**
   * Check if a tool call requires user approval
   */
  requiresApproval(securityTier: SecurityTier): boolean {
    // SecurityTier >= 3 (RESTRICTED) requires approval
    return securityTier >= 3;
  }

  /**
   * Request user approval for a tool call
   * Returns a promise that resolves when approved or rejects on timeout/denial
   */
  async requestApproval(
    sessionId: string,
    toolCall: ToolCall,
    securityTier: SecurityTier
  ): Promise<ApprovalResult> {
    // Generate unique request ID
    const requestId = this.generateRequestId();

    // Create approval request
    const request: ApprovalRequest = {
      id: requestId,
      toolCall,
      securityTier,
      createdAt: new Date(),
      sessionId,
    };

    // Store pending request
    this.pendingRequests.set(requestId, request);

    // Emit event for Gateway to publish to channel
    this.emit('approval-requested', request);

    try {
      // Wait for approval with timeout
      const result = await this.waitForApproval(requestId);
      return result;
    } finally {
      // Cleanup pending request
      this.pendingRequests.delete(requestId);
    }
  }

  /**
   * Approve a pending request
   */
  approve(requestId: string, userId?: string): boolean {
    const request = this.pendingRequests.get(requestId);
    if (!request) {
      return false;
    }

    // Emit approval event
    this.emit('approval-response', {
      requestId,
      approved: true,
      userId,
    });

    return true;
  }

  /**
   * Deny a pending request
   */
  deny(requestId: string, reason: string, userId?: string): boolean {
    const request = this.pendingRequests.get(requestId);
    if (!request) {
      return false;
    }

    // Emit denial event
    this.emit('approval-response', {
      requestId,
      approved: false,
      reason,
      userId,
    });

    return true;
  }

  /**
   * Get pending approval request
   */
  getPendingRequest(requestId: string): ApprovalRequest | undefined {
    return this.pendingRequests.get(requestId);
  }

  /**
   * Get all pending requests for a session
   */
  getPendingRequestsForSession(sessionId: string): ApprovalRequest[] {
    return Array.from(this.pendingRequests.values()).filter(
      (req) => req.sessionId === sessionId
    );
  }

  /**
   * Cancel all pending requests for a session
   */
  cancelSessionRequests(sessionId: string): void {
    for (const [id, request] of this.pendingRequests.entries()) {
      if (request.sessionId === sessionId) {
        this.deny(id, 'Session ended', undefined);
      }
    }
  }

  /**
   * Format approval request message for user
   */
  formatApprovalMessage(request: ApprovalRequest): string {
    const securityTierName = this.getSecurityTierName(request.securityTier);

    const lines = [
      `🔐 **Approval Required**`,
      '',
      `Tool: **${request.toolCall.tool}**`,
      `Security Tier: **${securityTierName}** (${request.securityTier})`,
      '',
      `**Parameters:**`,
      '```json',
      JSON.stringify(request.toolCall.parameters, null, 2),
      '```',
      '',
      `Request ID: \`${request.id}\``,
      '',
      `To approve: \`/approve ${request.id}\``,
      `To deny: \`/deny ${request.id}\``,
      '',
      `⏱️ This request will expire in ${this.approvalTimeoutMs / 1000} seconds`,
    ];

    return lines.join('\n');
  }

  /**
   * Wait for approval response
   */
  private async waitForApproval(requestId: string): Promise<ApprovalResult> {
    return new Promise((resolve) => {
      // Set timeout
      const timeout = setTimeout(() => {
        this.removeAllListeners(`approval-${requestId}`);
        resolve({
          approved: false,
          reason: 'Approval request timed out',
        });
      }, this.approvalTimeoutMs);

      // Listen for response
      const responseHandler = (response: ApprovalResult & { requestId: string }) => {
        if (response.requestId === requestId) {
          clearTimeout(timeout);
          this.removeAllListeners(`approval-${requestId}`);
          resolve({
            approved: response.approved,
            reason: response.reason,
            userId: response.userId,
          });
        }
      };

      this.on('approval-response', responseHandler);
    });
  }

  /**
   * Generate unique request ID
   */
  private generateRequestId(): string {
    return `approval-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Get security tier name
   */
  private getSecurityTierName(tier: SecurityTier): string {
    const names: Record<SecurityTier, string> = {
      0: 'SAFE',
      1: 'STANDARD',
      2: 'ELEVATED',
      3: 'RESTRICTED',
      4: 'DANGEROUS',
    };

    return names[tier] ?? 'UNKNOWN';
  }

  /**
   * Get approval timeout in milliseconds
   */
  getApprovalTimeout(): number {
    return this.approvalTimeoutMs;
  }

  /**
   * Set approval timeout in milliseconds
   */
  setApprovalTimeout(timeoutMs: number): void {
    this.approvalTimeoutMs = timeoutMs;
  }
}
