// Shared utilities for Nachos

export function noop(): void {
  // No operation
}

export type MentionPattern = string | RegExp;

export function isMentioned(text: string, patterns: MentionPattern[]): boolean {
  if (!text || patterns.length === 0) return false;
  return patterns.some((pattern) => {
    if (pattern instanceof RegExp) return pattern.test(text);
    return text.includes(pattern);
  });
}

export function isUserAllowlisted(userId: string, allowlist: string[]): boolean {
  return allowlist.includes(userId);
}

export async function shouldAllowDm(
  userId: string,
  allowlist: string[],
  pairingEnabled: boolean,
  isPaired: (id: string) => Promise<boolean>
): Promise<boolean> {
  if (isUserAllowlisted(userId, allowlist)) return true;
  if (!pairingEnabled) return false;
  return isPaired(userId);
}

export function shouldAllowGroupMessage(params: {
  channelId: string;
  userId: string;
  text: string;
  channelAllowlist: string[];
  userAllowlist: string[];
  mentionGating: boolean;
  mentionPatterns?: MentionPattern[];
}): boolean {
  const {
    channelId,
    userId,
    text,
    channelAllowlist,
    userAllowlist,
    mentionGating,
    mentionPatterns = [],
  } = params;

  if (!channelAllowlist.includes(channelId)) return false;
  if (!userAllowlist.includes(userId)) return false;
  if (!mentionGating) return true;
  return isMentioned(text, mentionPatterns);
}
