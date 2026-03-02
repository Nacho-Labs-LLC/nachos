/**
 * Structured System Prompt Builder
 *
 * Builds comprehensive system prompts with modular sections for better
 * AI assistant behavior and clearer guidance.
 */

import { tokenEstimator } from '@nachos/context-manager';

// Logger for future use
// import { createLogger } from '@nachos/types';
// const logger = createLogger('prompt-builder');

export interface RuntimeInfo {
  agentId?: string;
  host?: string;
  os?: string;
  arch?: string;
  node?: string;
  model?: string;
  defaultModel?: string;
  channel?: string;
  capabilities?: string[];
  workspaceDir?: string;
}

export interface PromptBuilderParams {
  /** Core identity/persona (from config or SOUL.md) */
  identity?: string;

  /** Available tool names */
  toolNames?: string[];

  /** Tool usage summaries/hints */
  toolSummaries?: Record<string, string>;

  /** Runtime environment information */
  runtimeInfo?: RuntimeInfo;

  /** User timezone */
  userTimezone?: string;

  /** Current date/time string */
  currentDateTime?: string;

  /** Owner identification (numbers, IDs, names) */
  ownerIdentification?: string;

  /** Formatted skills documentation */
  skills?: string;

  /** Heartbeat poll prompt */
  heartbeatPrompt?: string;

  /** Documentation path */
  docsPath?: string;

  /** Workspace-specific notes */
  workspaceNotes?: string[];

  /** Whether memory tools are available */
  hasMemoryTools?: boolean;

  /** Whether messaging tools are available */
  hasMessagingTools?: boolean;

  /** Message channel options (telegram|discord|etc.) */
  messageChannelOptions?: string;

  /** Platform-specific formatting hints */
  platformHints?: string[];

  /** Silent reply token */
  silentReplyToken?: string;

  /** Whether to include full sections or minimal */
  promptMode?: 'full' | 'minimal' | 'none';
}

export interface SystemPromptBuildResult {
  prompt: string;
  estimatedTokens: number;
}

export class SystemPromptBuilder {
  build(params: PromptBuilderParams): SystemPromptBuildResult {
    const sections: string[] = [];
    const mode = params.promptMode ?? 'full';

    // Minimal mode: just identity + runtime
    if (mode === 'none') {
      if (params.identity) {
        sections.push(params.identity.trim());
      }
      const prompt = sections.join('\n\n');
      return {
        prompt,
        estimatedTokens: tokenEstimator.estimate(prompt),
      };
    }

    // Core identity (always included)
    if (params.identity) {
      sections.push(this.buildIdentitySection(params.identity));
    }

    // Full mode sections
    if (mode === 'full') {
      // Tooling section
      if (params.toolNames && params.toolNames.length > 0) {
        sections.push(this.buildToolingSection(params));
      }

      // Memory recall section
      if (params.hasMemoryTools) {
        sections.push(this.buildMemorySection());
      }

      // Workspace section
      if (params.runtimeInfo?.workspaceDir) {
        sections.push(this.buildWorkspaceSection(params));
      }

      // User identity
      if (params.ownerIdentification) {
        sections.push(this.buildUserIdentitySection(params.ownerIdentification));
      }

      // Current date/time
      if (params.userTimezone || params.currentDateTime) {
        sections.push(this.buildDateTimeSection(params));
      }

      // Messaging guidance
      if (params.hasMessagingTools) {
        sections.push(this.buildMessagingSection(params));
      }

      // Heartbeat section
      if (params.heartbeatPrompt) {
        sections.push(this.buildHeartbeatSection(params.heartbeatPrompt));
      }

      // Documentation
      if (params.docsPath) {
        sections.push(this.buildDocumentationSection(params.docsPath));
      }

      // Platform hints
      if (params.platformHints && params.platformHints.length > 0) {
        sections.push(this.buildPlatformHintsSection(params.platformHints));
      }
    }

    // Runtime section (always included, even in minimal mode)
    if (params.runtimeInfo) {
      sections.push(this.buildRuntimeSection(params.runtimeInfo));
    }

    // Skills section (if provided)
    if (params.skills) {
      sections.push(params.skills);
    }

    const prompt = sections.join('\n\n');

    // H3: Return both prompt and estimated token count
    return {
      prompt,
      estimatedTokens: tokenEstimator.estimate(prompt),
    };
  }

  private buildIdentitySection(identity: string): string {
    return identity.trim();
  }

  private buildToolingSection(params: PromptBuilderParams): string {
    const lines: string[] = [
      '## Tooling',
      '',
      `Tool availability: ${params.toolNames?.join(', ')}`,
      '',
    ];

    if (params.toolSummaries && Object.keys(params.toolSummaries).length > 0) {
      lines.push('**Tool Summaries:**');
      for (const [tool, summary] of Object.entries(params.toolSummaries)) {
        lines.push(`- \`${tool}\`: ${summary}`);
      }
      lines.push('');
    }

    lines.push(
      '**Tool Use Guidelines:**',
      '- Call tools directly when needed; no need to narrate routine calls',
      '- Narrate only for complex/multi-step work or when user explicitly asks',
      '- If a tool fails, try alternatives before giving up',
      '- Combine tools efficiently (e.g., web_search → web_fetch)',
      ''
    );

    return lines.join('\n');
  }

  private buildMemorySection(): string {
    return `## Memory Recall

Use \`memory_search\` to query stored memories from previous sessions.

**When to search:**
- User asks about past conversations, decisions, or work
- User references something you should remember
- Checking previous decisions before making new ones

**When NOT to search:**
- Current conversation (already visible)
- General knowledge questions
- Real-time information

**Limits:** 1-2 searches per response, only when genuinely needed.`;
  }

  private buildWorkspaceSection(params: PromptBuilderParams): string {
    const lines: string[] = [
      '## Workspace',
      `Working directory: ${params.runtimeInfo?.workspaceDir}`,
      '',
    ];

    if (params.workspaceNotes && params.workspaceNotes.length > 0) {
      lines.push('**Notes:**');
      for (const note of params.workspaceNotes) {
        lines.push(`- ${note}`);
      }
      lines.push('');
    }

    lines.push(
      'Treat this directory as your home. File operations are relative to this path unless specified otherwise.',
      ''
    );

    return lines.join('\n');
  }

  private buildUserIdentitySection(ownerIdentification: string): string {
    return `## User Identity\n${ownerIdentification}`;
  }

  private buildDateTimeSection(params: PromptBuilderParams): string {
    const lines: string[] = ['## Current Date & Time'];

    if (params.userTimezone) {
      lines.push(`Time zone: ${params.userTimezone}`);
    }

    if (params.currentDateTime) {
      lines.push(`Current time: ${params.currentDateTime}`);
    }

    return lines.join('\n');
  }

  private buildMessagingSection(params: PromptBuilderParams): string {
    const lines: string[] = [
      '## Messaging',
      '',
      '- Reply in current session → auto-routes to source channel',
      '- Cross-session messaging → use sessions_send(sessionKey, message)',
      '- System messages are internal; rewrite for users',
      '',
    ];

    if (params.messageChannelOptions) {
      lines.push(
        '**message tool:**',
        '- Use for proactive sends + channel actions',
        `- Multiple channels configured: pass \`channel\` (${params.messageChannelOptions})`,
        ''
      );
    }

    if (params.silentReplyToken) {
      lines.push(
        `If you use \`message\` tool to reply, respond with ONLY: ${params.silentReplyToken}`,
        ''
      );
    }

    return lines.join('\n');
  }

  private buildHeartbeatSection(heartbeatPrompt: string): string {
    return `## Heartbeat\n${heartbeatPrompt}`;
  }

  private buildDocumentationSection(docsPath: string): string {
    return `## Documentation

Nachos docs: ${docsPath}
Source: https://github.com/Nacho-Labs-LLC/nachos
Community: https://discord.com/invite/nachos

For Nachos behavior, config, or architecture: consult docs first.`;
  }

  private buildPlatformHintsSection(hints: string[]): string {
    const lines: string[] = ['## Platform Formatting'];

    for (const hint of hints) {
      lines.push(`- ${hint}`);
    }

    return lines.join('\n');
  }

  private buildRuntimeSection(info: RuntimeInfo): string {
    const lines: string[] = ['## Runtime'];

    const pairs: Array<[string, string | undefined]> = [
      ['Agent', info.agentId],
      ['Host', info.host],
      ['OS', info.os],
      ['Architecture', info.arch],
      ['Node', info.node],
      ['Model', info.model],
      ['Default Model', info.defaultModel],
      ['Channel', info.channel],
      ['Workspace', info.workspaceDir],
    ];

    for (const [label, value] of pairs) {
      if (value) {
        lines.push(`${label}: ${value}`);
      }
    }

    if (info.capabilities && info.capabilities.length > 0) {
      lines.push(`Capabilities: ${info.capabilities.join(', ')}`);
    }

    return lines.join('\n');
  }
}

/**
 * Platform-specific formatting hint generators
 */
export class PlatformHints {
  static discord(): string[] {
    return [
      'Discord: No markdown tables (use bullet lists)',
      'Discord: Wrap multiple links in <> to suppress embeds',
      'Discord: Status emojis show bot activity (🧠💻🌐✅)',
    ];
  }

  static telegram(): string[] {
    return [
      'Telegram: Markdown supported (bold, italic, code)',
      'Telegram: Message length limit ~4000 chars',
    ];
  }

  static slack(): string[] {
    return [
      'Slack: mrkdwn format (not full markdown)',
      'Slack: Use threads for long conversations',
    ];
  }

  static general(): string[] {
    return [
      'Keep messages concise for chat platforms',
      'Use code blocks for technical output',
      'Break long responses into multiple messages if needed',
    ];
  }
}
