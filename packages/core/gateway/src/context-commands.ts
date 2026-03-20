import type { ContextManagementCommandsConfig } from '@nachos/config';
import type { Session, SessionWithMessages } from '@nachos/types';

export type ResolvedContextCommandConfig = {
  enabled: boolean;
  allowInDms: boolean;
  allowInChannels: boolean;
  adminAllowlist: Set<string>;
  resetTriggers: string[];
  contextTriggers: string[];
  identityTriggers: string[];
  helpTriggers: string[];
};

export function resolveContextCommandConfig(
  config: ContextManagementCommandsConfig | undefined
): ResolvedContextCommandConfig {
  const resolved = config ?? {};
  return {
    enabled: resolved.enabled ?? true,
    allowInDms: resolved.allow_in_dms ?? true,
    allowInChannels: resolved.allow_in_channels ?? false,
    adminAllowlist: new Set(resolved.admin_allowlist ?? []),
    resetTriggers: (resolved.reset_triggers ?? ['/new', '/reset']).filter(Boolean),
    contextTriggers: (resolved.context_triggers ?? ['/context']).filter(Boolean),
    identityTriggers: (resolved.identity_triggers ?? ['/identity']).filter(Boolean),
    helpTriggers: (resolved.help_triggers ?? ['/help', '!help']).filter(Boolean),
  };
}

export function parseContextCommand(
  text: string,
  config: ResolvedContextCommandConfig
): {
  type: 'reset' | 'context' | 'identity' | 'help';
  trigger: string;
  remainder: string;
} | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const matchTrigger = (triggers: string[]) => {
    const normalizedText = trimmed.toLowerCase();
    for (const trigger of triggers) {
      const normalizedTrigger = trigger.trim().toLowerCase();
      if (!normalizedTrigger) continue;
      if (normalizedText === normalizedTrigger) {
        return { trigger: normalizedTrigger, remainder: '' };
      }
      if (normalizedText.startsWith(`${normalizedTrigger} `)) {
        const remainder = trimmed.slice(normalizedTrigger.length).trim();
        return { trigger: normalizedTrigger, remainder };
      }
    }
    return null;
  };

  const reset = matchTrigger(config.resetTriggers);
  if (reset) {
    return { type: 'reset', trigger: reset.trigger, remainder: reset.remainder };
  }

  const identity = matchTrigger(config.identityTriggers);
  if (identity) {
    return { type: 'identity', trigger: identity.trigger, remainder: identity.remainder };
  }

  const context = matchTrigger(config.contextTriggers);
  if (context) {
    return { type: 'context', trigger: context.trigger, remainder: context.remainder };
  }

  const help = matchTrigger(config.helpTriggers);
  if (help) {
    return { type: 'help', trigger: help.trigger, remainder: help.remainder };
  }

  return null;
}

export function getContextManagementOverride(session: Session | SessionWithMessages): boolean | null {
  const metadata = session.metadata as { contextManagement?: { enabled?: boolean } } | null;
  if (!metadata?.contextManagement) return null;
  const enabled = metadata.contextManagement.enabled;
  return typeof enabled === 'boolean' ? enabled : null;
}

export function isContextManagementEnabledForSession(session: Session | SessionWithMessages): boolean {
  const override = getContextManagementOverride(session);
  if (override === false) return false;
  return true;
}
