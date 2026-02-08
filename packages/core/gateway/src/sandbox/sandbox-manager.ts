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
    const workspaceDir =
      workspaceAccess === 'none' ? undefined : (this.runtimePaths.workspaceDir ?? './workspace');

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
}
