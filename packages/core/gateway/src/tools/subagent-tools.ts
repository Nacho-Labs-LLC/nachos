import type { LLMRequestType, Session } from '@nachos/types';
import type { SubagentToolPolicyConfig, SubagentToolProfileConfig, ToolsConfig } from '@nachos/config';
import { SubagentProgressToolSchema } from '@nachos/types';
import { getExternalToolDefinitions } from './external-tool-definitions.js';
import { normalizeToolName } from '../utils/session-utils.js';
import { readOptionalString } from '../utils/parsing.js';
import type { SubagentRunRecord } from '../subagents/types.js';

export interface SubagentToolsDeps {
  toolsConfig?: ToolsConfig;
  subagentToolPolicy?: SubagentToolPolicyConfig;
}

export class SubagentTools {
  private readonly deps: SubagentToolsDeps;

  constructor(deps: SubagentToolsDeps) {
    this.deps = deps;
  }

  private sanitizeToolSchema(schema: Record<string, unknown>): Record<string, unknown> {
    const cloned = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
    delete cloned.$id;
    return cloned;
  }

  canAccessSubagentRun(session: Session, run: SubagentRunRecord): boolean {
    if (session.id === run.requester.sessionId) return true;
    if (session.userId && run.requester.userId && session.userId === run.requester.userId) return true;
    return false;
  }

  filterSubagentRunsForSession(session: Session, runs: SubagentRunRecord[]): SubagentRunRecord[] {
    return runs.filter((run) => this.canAccessSubagentRun(session, run));
  }

  buildSubagentToolDefinitions(session?: Session | null): LLMRequestType['tools'] {
    const tools: NonNullable<LLMRequestType['tools']> = [];

    // Always include subagent_progress
    tools.push({
      name: 'subagent_progress',
      description:
        'Report progress on the current task. Use this to keep the requester informed of your progress. The runId is automatically determined from your session context.',
      parameters: this.sanitizeToolSchema(SubagentProgressToolSchema),
    });

    // Resolve profile-based tool allow list
    const profileName = this.resolveSubagentProfile(session ?? null);
    const profilePolicy = this.resolveSubagentProfilePolicy(profileName);
    const allowList = profilePolicy?.allow && profilePolicy.allow.length > 0
      ? new Set(profilePolicy.allow.map((t) => normalizeToolName(t)))
      : null;

    // No allow list = no extra tools for the subagent (default restrictive behavior)
    if (!allowList) return tools;

    // Get all enabled external tool definitions from global config
    // (browser/exec tools are local-only and not offered to subagents via profiles)
    const allAvailable = getExternalToolDefinitions(this.deps.toolsConfig);

    for (const extTool of allAvailable) {
      const normalized = normalizeToolName(extTool.name);
      if (!allowList.has(normalized)) continue;

      // Skip tools that are in the profile deny list or global subagent deny list
      const policyCheck = this.evaluateSubagentToolPolicy(extTool.name, session);
      if (!policyCheck.allowed) continue;

      tools.push({
        name: extTool.name,
        description: extTool.description,
        parameters: this.sanitizeToolSchema(extTool.parameters),
      });
    }

    return tools;
  }

  evaluateSubagentToolPolicy(
    tool: string,
    session?: Session | null
  ): { allowed: boolean; reason?: string } {
    const DEFAULT_SUBAGENT_DENY_TOOLS = new Set([
      'sessions_list',
      'sessions_history',
      'sessions_send',
      'sessions_spawn',
    ]);

    const normalized = normalizeToolName(tool);
    const policy = this.deps.subagentToolPolicy;
    const profileName = this.resolveSubagentProfile(session ?? null);
    const profilePolicy = this.resolveSubagentProfilePolicy(profileName);
    const denyList = new Set(
      [
        ...DEFAULT_SUBAGENT_DENY_TOOLS,
        ...(policy?.deny ?? []).map((entry) => normalizeToolName(entry)),
        ...(profilePolicy?.deny ?? []).map((entry) => normalizeToolName(entry)),
      ].filter((entry) => entry.length > 0)
    );

    if (denyList.has(normalized)) {
      return { allowed: false, reason: `Tool blocked for subagents: ${tool}` };
    }

    const allowListSource =
      profilePolicy?.allow && profilePolicy.allow.length > 0
        ? profilePolicy.allow
        : (policy?.allow ?? []);
    const allow = allowListSource.map((entry) => normalizeToolName(entry));
    if (allow.length > 0 && !allow.includes(normalized)) {
      const profileSuffix = profileName ? ` (profile: ${profileName})` : '';
      return {
        allowed: false,
        reason: `Tool not allowlisted for subagents${profileSuffix}: ${tool}`,
      };
    }

    return { allowed: true };
  }

  resolveSubagentProfile(session: Session | null): string | undefined {
    const defaultProfile = readOptionalString(this.deps.subagentToolPolicy?.default_profile);
    if (!session?.metadata || typeof session.metadata !== 'object') {
      return defaultProfile;
    }
    const metadata = session.metadata as { subagent?: { profile?: string } };
    const profile = readOptionalString(metadata.subagent?.profile);
    return profile ?? defaultProfile;
  }

  resolveSubagentProfilePolicy(profile?: string): SubagentToolProfileConfig | undefined {
    const profiles = this.deps.subagentToolPolicy?.profiles;
    if (!profile || !profiles) return undefined;

    if (profiles[profile]) return profiles[profile];

    const normalized = normalizeToolName(profile);
    const match = Object.entries(profiles).find(([name]) => normalizeToolName(name) === normalized);
    return match?.[1];
  }
}
