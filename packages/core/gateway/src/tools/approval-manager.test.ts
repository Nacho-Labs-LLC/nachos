import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApprovalManager, type ApprovalRequest } from './approval-manager.js';
import { SecurityTier, type ToolCall } from '@nachos/types';

function makeToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    id: 'call-1',
    tool: 'code-runner',
    sessionId: 'session-1',
    parameters: { code: 'console.log("hi")' },
    ...overrides,
  };
}

describe('ApprovalManager', () => {
  let manager: ApprovalManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new ApprovalManager(5_000); // 5 s timeout for fast tests
  });

  afterEach(() => {
    vi.useRealTimers();
    manager.removeAllListeners();
  });

  // ---------------------------------------------------------------
  // Creating pending requests
  // ---------------------------------------------------------------

  it('[AF-01] should create pending request with correct fields', async () => {
    const toolCall = makeToolCall();
    const tier = SecurityTier.RESTRICTED;

    // Start approval (don't await — we'll resolve manually)
    const promise = manager.requestApproval('session-1', toolCall, tier, 'user-42');

    const pending = manager.getAllPendingRequests();
    expect(pending).toHaveLength(1);
    expect(pending[0].toolCall).toBe(toolCall);
    expect(pending[0].securityTier).toBe(SecurityTier.RESTRICTED);
    expect(pending[0].sessionId).toBe('session-1');
    expect(pending[0].requesterUserId).toBe('user-42');
    expect(pending[0].id).toEqual(expect.any(String));
    expect(pending[0].createdAt).toBeInstanceOf(Date);

    // Clean up — let it time out
    vi.advanceTimersByTime(6_000);
    await promise;
  });

  // ---------------------------------------------------------------
  // Approving a request
  // ---------------------------------------------------------------

  it('[AF-05] should approve a pending request and return true', async () => {
    const toolCall = makeToolCall();
    const promise = manager.requestApproval('s1', toolCall, SecurityTier.RESTRICTED);

    const [req] = manager.getAllPendingRequests();
    const approved = manager.approve(req.id, 'owner-1');

    expect(approved).toBe(true);

    const result = await promise;
    expect(result.approved).toBe(true);
    expect(result.userId).toBe('owner-1');
  });

  // ---------------------------------------------------------------
  // Denying a request with reason
  // ---------------------------------------------------------------

  it('[AF-06] should deny a pending request with reason', async () => {
    const toolCall = makeToolCall();
    const promise = manager.requestApproval('s1', toolCall, SecurityTier.DANGEROUS);

    const [req] = manager.getAllPendingRequests();
    const denied = manager.deny(req.id, 'too dangerous', 'owner-1');

    expect(denied).toBe(true);

    const result = await promise;
    expect(result.approved).toBe(false);
    expect(result.reason).toBe('too dangerous');
    expect(result.userId).toBe('owner-1');
  });

  // ---------------------------------------------------------------
  // Getting a pending request by ID
  // ---------------------------------------------------------------

  it('[AF-05] should get a pending request by ID', async () => {
    const toolCall = makeToolCall({ tool: 'docker-exec' });
    const promise = manager.requestApproval('s1', toolCall, SecurityTier.RESTRICTED);

    const [req] = manager.getAllPendingRequests();
    const found = manager.getPendingRequest(req.id);

    expect(found).toBeDefined();
    expect(found!.toolCall.tool).toBe('docker-exec');

    // Cleanup
    manager.approve(req.id);
    await promise;
  });

  // ---------------------------------------------------------------
  // Getting all pending requests
  // ---------------------------------------------------------------

  it('[AF-07] should return all pending requests', async () => {
    const p1 = manager.requestApproval('s1', makeToolCall({ id: 'c1' }), SecurityTier.RESTRICTED);
    const p2 = manager.requestApproval('s2', makeToolCall({ id: 'c2' }), SecurityTier.DANGEROUS);

    const pending = manager.getAllPendingRequests();
    expect(pending).toHaveLength(2);

    // Cleanup
    for (const req of pending) manager.approve(req.id);
    await Promise.all([p1, p2]);
  });

  // ---------------------------------------------------------------
  // Approving an already-resolved request returns false
  // ---------------------------------------------------------------

  it('[AF-05] should return false when approving an already-resolved request', async () => {
    const promise = manager.requestApproval('s1', makeToolCall(), SecurityTier.RESTRICTED);

    const [req] = manager.getAllPendingRequests();
    manager.approve(req.id);
    await promise;

    // The request has been cleaned up from the pending map
    const second = manager.approve(req.id);
    expect(second).toBe(false);
  });

  // ---------------------------------------------------------------
  // Denying an already-resolved request returns false
  // ---------------------------------------------------------------

  it('[AF-06] should return false when denying an already-resolved request', async () => {
    const promise = manager.requestApproval('s1', makeToolCall(), SecurityTier.RESTRICTED);

    const [req] = manager.getAllPendingRequests();
    manager.approve(req.id);
    await promise;

    const second = manager.deny(req.id, 'late');
    expect(second).toBe(false);
  });

  // ---------------------------------------------------------------
  // Getting non-existent request
  // ---------------------------------------------------------------

  it('[AF-05] should return undefined for non-existent request', () => {
    expect(manager.getPendingRequest('does-not-exist')).toBeUndefined();
  });

  // ---------------------------------------------------------------
  // Timeout handling
  // ---------------------------------------------------------------

  it('[AF-04] should deny request on timeout', async () => {
    const promise = manager.requestApproval('s1', makeToolCall(), SecurityTier.RESTRICTED);

    vi.advanceTimersByTime(6_000); // exceeds 5 s timeout

    const result = await promise;
    expect(result.approved).toBe(false);
    expect(result.reason).toContain('timed out');
  });

  // ---------------------------------------------------------------
  // requiresApproval
  // ---------------------------------------------------------------

  it('[AF-01] should require approval for SecurityTier >= RESTRICTED', () => {
    expect(manager.requiresApproval(SecurityTier.SAFE)).toBe(false);
    expect(manager.requiresApproval(SecurityTier.STANDARD)).toBe(false);
    expect(manager.requiresApproval(SecurityTier.ELEVATED)).toBe(false);
    expect(manager.requiresApproval(SecurityTier.RESTRICTED)).toBe(true);
    expect(manager.requiresApproval(SecurityTier.DANGEROUS)).toBe(true);
  });

  // ---------------------------------------------------------------
  // formatApprovalMessage
  // ---------------------------------------------------------------

  it('[AF-12] should format approval message with tool name, tier, params, and request ID', async () => {
    const toolCall = makeToolCall({ tool: 'code-runner', parameters: { lang: 'python' } });
    const promise = manager.requestApproval('s1', toolCall, SecurityTier.RESTRICTED);

    const [req] = manager.getAllPendingRequests();
    const msg = manager.formatApprovalMessage(req);

    expect(msg).toContain('code-runner');
    expect(msg).toContain('RESTRICTED');
    expect(msg).toContain(req.id);
    expect(msg).toContain('/approve');
    expect(msg).toContain('/deny');
    expect(msg).toContain('"lang": "python"');
    expect(msg).toContain('Approval Required');

    // Cleanup
    manager.approve(req.id);
    await promise;
  });

  // ---------------------------------------------------------------
  // EventEmitter: 'approval-requested' fires on create
  // ---------------------------------------------------------------

  it('[AF-11] should emit approval-requested event on requestApproval', async () => {
    const handler = vi.fn();
    manager.on('approval-requested', handler);

    const promise = manager.requestApproval('s1', makeToolCall(), SecurityTier.RESTRICTED);

    expect(handler).toHaveBeenCalledTimes(1);
    const emittedReq: ApprovalRequest = handler.mock.calls[0][0];
    expect(emittedReq.sessionId).toBe('s1');
    expect(emittedReq.securityTier).toBe(SecurityTier.RESTRICTED);

    // Cleanup
    manager.approve(emittedReq.id);
    await promise;
  });

  // ---------------------------------------------------------------
  // EventEmitter: 'approval-response' fires on approve/deny
  // ---------------------------------------------------------------

  it('[AF-11] should emit approval-response event on approve', async () => {
    const handler = vi.fn();
    manager.on('approval-response', handler);

    const promise = manager.requestApproval('s1', makeToolCall(), SecurityTier.RESTRICTED);
    const [req] = manager.getAllPendingRequests();

    manager.approve(req.id, 'admin');

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: req.id,
        approved: true,
        userId: 'admin',
      })
    );

    await promise;
  });

  it('[AF-11] should emit approval-response event on deny', async () => {
    const handler = vi.fn();
    manager.on('approval-response', handler);

    const promise = manager.requestApproval('s1', makeToolCall(), SecurityTier.RESTRICTED);
    const [req] = manager.getAllPendingRequests();

    manager.deny(req.id, 'nope', 'admin');

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: req.id,
        approved: false,
        reason: 'nope',
        userId: 'admin',
      })
    );

    await promise;
  });

  // ---------------------------------------------------------------
  // approve-all: only pending requests affected
  // ---------------------------------------------------------------

  it('[AF-07] approve-all pattern: approving all pending requests only affects pending ones', async () => {
    const p1 = manager.requestApproval('s1', makeToolCall({ id: 'c1' }), SecurityTier.RESTRICTED);
    const p2 = manager.requestApproval('s2', makeToolCall({ id: 'c2' }), SecurityTier.DANGEROUS);

    // Resolve first request before bulk approve
    const pending1 = manager.getAllPendingRequests();
    manager.approve(pending1[0].id);
    await p1;

    // Now only one should be pending
    const remaining = manager.getAllPendingRequests();
    expect(remaining).toHaveLength(1);

    // Approve the remaining (simulating /approve-all logic)
    for (const req of remaining) {
      manager.approve(req.id, 'owner');
    }
    const result2 = await p2;
    expect(result2.approved).toBe(true);

    expect(manager.getAllPendingRequests()).toHaveLength(0);
  });

  // ---------------------------------------------------------------
  // cancelSessionRequests
  // ---------------------------------------------------------------

  it('[AF-10] cancelSessionRequests should deny all pending requests for a session', async () => {
    const p1 = manager.requestApproval('s1', makeToolCall({ id: 'c1' }), SecurityTier.RESTRICTED);
    const p2 = manager.requestApproval('s1', makeToolCall({ id: 'c2' }), SecurityTier.DANGEROUS);
    const p3 = manager.requestApproval('s2', makeToolCall({ id: 'c3' }), SecurityTier.RESTRICTED);

    manager.cancelSessionRequests('s1');

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.approved).toBe(false);
    expect(r1.reason).toBe('Session ended');
    expect(r2.approved).toBe(false);
    expect(r2.reason).toBe('Session ended');

    // s2 still pending
    expect(manager.getAllPendingRequests()).toHaveLength(1);
    expect(manager.getAllPendingRequests()[0].sessionId).toBe('s2');

    // Cleanup
    manager.approve(manager.getAllPendingRequests()[0].id);
    await p3;
  });

  // ---------------------------------------------------------------
  // getPendingRequestsForSession
  // ---------------------------------------------------------------

  it('[AF-07] getPendingRequestsForSession filters by session', async () => {
    const p1 = manager.requestApproval('s1', makeToolCall({ id: 'c1' }), SecurityTier.RESTRICTED);
    const p2 = manager.requestApproval('s2', makeToolCall({ id: 'c2' }), SecurityTier.RESTRICTED);

    const s1Requests = manager.getPendingRequestsForSession('s1');
    expect(s1Requests).toHaveLength(1);
    expect(s1Requests[0].sessionId).toBe('s1');

    const s2Requests = manager.getPendingRequestsForSession('s2');
    expect(s2Requests).toHaveLength(1);
    expect(s2Requests[0].sessionId).toBe('s2');

    // Cleanup
    for (const req of manager.getAllPendingRequests()) manager.approve(req.id);
    await Promise.all([p1, p2]);
  });
});
