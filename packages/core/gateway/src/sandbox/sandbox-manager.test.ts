import { describe, expect, it } from 'vitest';
import type { Session } from '@nachos/types';
import { SandboxManager } from './sandbox-manager.js';

describe('SandboxManager', () => {
  const baseSession: Session = {
    id: 'session-1',
    channel: 'slack',
    conversationId: 'conv-1',
    userId: 'user-1',
    status: 'active',
    config: {},
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it('disables sandbox when mode is off', () => {
    const manager = new SandboxManager({ mode: 'off' });
    const decision = manager.resolveToolSandbox(baseSession);
    expect(decision.enabled).toBe(false);
  });

  it('enables sandbox for non-main sessions when mode is non-main', () => {
    const manager = new SandboxManager({ mode: 'non-main' });
    const subagentSession = {
      ...baseSession,
      metadata: { subagent: { runId: 'run-1' } },
    };

    const mainDecision = manager.resolveToolSandbox(baseSession);
    const subDecision = manager.resolveToolSandbox(subagentSession);

    expect(mainDecision.enabled).toBe(false);
    expect(subDecision.enabled).toBe(true);
  });

  it('enables sandbox for all sessions when mode is all', () => {
    const manager = new SandboxManager({ mode: 'all' });
    const decision = manager.resolveToolSandbox(baseSession);
    expect(decision.enabled).toBe(true);
    expect(decision.config?.provider).toBe('docker');
  });

  it('omits workspace when access is none', () => {
    const manager = new SandboxManager(
      { mode: 'all', workspace_access: 'none' },
      { workspaceDir: './workspace' }
    );
    const decision = manager.resolveToolSandbox(baseSession);
    expect(decision.config?.workspaceDir).toBeUndefined();
    expect(decision.config?.workspaceAccess).toBe('none');
  });
});
