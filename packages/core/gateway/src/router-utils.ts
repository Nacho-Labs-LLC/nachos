export function getRateLimitUserId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }
  const record = payload as { sessionId?: string; sender?: { id?: string } };
  if (typeof record.sessionId === 'string') {
    return record.sessionId;
  }
  if (record.sender && typeof record.sender.id === 'string') {
    return record.sender.id;
  }
  return undefined;
}
