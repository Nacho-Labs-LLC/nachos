/**
 * Tool sandbox decision manager.
 */

import type { RuntimeToolSandboxConfig } from '@nachos/config';
import type { Session, ToolSandboxConfig } from '@nachos/types';

export interface SandboxDecision {
  enabled: boolean;
  config?: ToolSandboxConfig;
}

export class SandboxManager {
  constructor(
    private config: RuntimeToolSandboxConfig | undefined,
    private runtimePaths: {
      workspaceDir?: string;
    } = {}
  ) {}

  resolveToolSandbox(session: Session | null): SandboxDecision {
    const mode = this.config?.mode ?? 'off';
    if (mode === 'off') {
      return { enabled: false };
    }

    const isNonMain = Boolean(session?.metadata && 'subagent' in session.metadata);
    if (mode === 'non-main' && !isNonMain) {
      return { enabled: false };
    }

    const workspaceAccess = this.config?.workspace_access ?? 'rw';
    const subagentWorkspace = this.resolveSubagentWorkspaceDir(session);
    const workspaceDir =
      workspaceAccess === 'none'
        ? undefined
        : (subagentWorkspace ?? this.runtimePaths.workspaceDir ?? './workspace');

    return {
      enabled: true,
      config: {
        enabled: true,
        provider: 'docker',
        workspaceDir,
        workspaceAccess,
        extraBinds: this.config?.extra_binds,
        env: this.config?.env,
        setupCommand: this.config?.setup_command,
        network: this.config?.network ?? 'egress',
      },
    };
  }

  private resolveSubagentWorkspaceDir(session: Session | null): string | undefined {
    if (!session?.metadata || typeof session.metadata !== 'object') {
      return undefined;
    }
    const metadata = session.metadata as Record<string, unknown>;
    const subagent = metadata.subagent as { workspaceDir?: unknown } | undefined;
    if (!subagent || typeof subagent.workspaceDir !== 'string') {
      return undefined;
    }
    return subagent.workspaceDir;
  }
}
