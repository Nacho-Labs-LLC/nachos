/**
 * Subagent announce helpers.
 */

import type { LLMMessageType, LLMResponseType } from '@nachos/types';
import type { SubagentRunRecord, SubagentResult } from './types.js';

export const DEFAULT_ANNOUNCE_TEMPLATE = [
  'You are reporting a subagent run back to the requester.',
  'Return a concise update using this exact structure:',
  'Status: <success|failed|cancelled>',
  'Result: <short summary>',
  'Notes: <optional>',
  'Stats: durationMs=<number> sandboxed=<true|false>',
  '',
  'Task:',
  '{{task}}',
  '',
  'Subagent response:',
  '{{response}}',
  '',
  'Error:',
  '{{error}}',
].join('\n');

export function buildAnnouncePrompt(params: {
  template?: string;
  run: SubagentRunRecord;
  result?: SubagentResult;
  responseText?: string;
}): string {
  const template = params.template?.trim().length ? params.template : DEFAULT_ANNOUNCE_TEMPLATE;
  const safe = (value?: string | number | boolean | null) =>
    value === undefined || value === null ? '' : String(value);

  return template
    .replace(/{{task}}/g, safe(params.run.task))
    .replace(/{{response}}/g, safe(params.responseText))
    .replace(/{{error}}/g, safe(params.run.error?.message))
    .replace(/{{status}}/g, safe(params.run.status))
    .replace(/{{runId}}/g, safe(params.run.runId))
    .replace(/{{durationMs}}/g, safe(params.run.durationMs))
    .replace(/{{sandboxed}}/g, safe(params.run.sandboxed));
}

export function buildAnnounceFallback(run: SubagentRunRecord, responseText?: string): string {
  const status = run.status === 'completed' ? 'success' : run.status;
  const resultLine = responseText?.trim()
    ? responseText.trim()
    : (run.error?.message ?? 'No output');
  const duration = run.durationMs ?? 0;
  const sandboxed = run.sandboxed ? 'true' : 'false';

  return [
    `Status: ${status}`,
    `Result: ${resultLine}`,
    `Stats: durationMs=${duration} sandboxed=${sandboxed}`,
  ].join('\n');
}

export function extractResponseText(response?: LLMResponseType): string | undefined {
  const message = response?.message;
  return extractMessageText(message);
}

export function extractMessageText(message?: LLMMessageType): string | undefined {
  if (!message) return undefined;
  if (typeof message.content === 'string') {
    return message.content;
  }
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => (typeof part.text === 'string' ? part.text : ''))
      .filter((text) => text.length > 0)
      .join('\n')
      .trim();
  }
  return undefined;
}
