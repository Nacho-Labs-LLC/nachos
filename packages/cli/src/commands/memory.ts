/**
 * nachos memory commands
 * Manage state-layer memory entries and facts.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { MemoryEntry, MemoryFact, MemoryKind, MemoryQuery } from '@nachos/types';
import { loadAndValidateConfig } from '@nachos/config';
import type { StateOperationContext } from '@nachos/state';
import { createStateLayerFromConfig } from '../core/state-layer.js';
import { findConfigFileOrThrow } from '../core/config-discovery.js';
import { CLIError } from '../core/errors.js';
import { OutputFormatter, prettyOutput } from '../core/output.js';
import { getVersion } from '../cli.js';

const MEMORY_KINDS: MemoryKind[] = ['summary', 'preference', 'fact', 'decision', 'task', 'issue'];

interface BaseMemoryOptions {
  json?: boolean;
  agentId?: string;
  userId?: string;
  sessionId?: string;
}

interface MemoryQueryOptions extends BaseMemoryOptions {
  kinds?: string;
  tags?: string;
  text?: string;
  limit?: string;
  offset?: string;
}

interface MemoryAppendEntryOptions extends BaseMemoryOptions {
  kind?: string;
  content?: string;
  tags?: string;
  confidence?: string;
  expiresAt?: string;
  source?: string;
  provenanceFile?: string;
}

interface MemoryAppendFactOptions extends BaseMemoryOptions {
  subject?: string;
  predicate?: string;
  object?: string;
  confidence?: string;
  sourceEntryId?: string;
}

interface MemoryDeleteOptions extends BaseMemoryOptions {
  id?: string;
}

export async function memoryQueryCommand(options: MemoryQueryOptions): Promise<void> {
  const output = new OutputFormatter(options.json ?? false, 'memory query', getVersion());

  try {
    const agentId = ensureValue(options.agentId, 'agent-id');
    const configPath = findConfigFileOrThrow();
    const config = loadAndValidateConfig({ configPath });
    const stateLayer = createStateLayerFromConfig(config);

    try {
      const query: MemoryQuery = {
        agentId,
        kinds: parseKinds(options.kinds),
        tags: parseCsv(options.tags),
        text: options.text,
        limit: parseOptionalInt(options.limit, 'limit'),
        offset: parseOptionalInt(options.offset, 'offset'),
      };

      const result = await stateLayer.queryMemory(
        query,
        buildContext(config.security?.mode, options)
      );

      if (options.json) {
        output.success({ query, entries: result.entries, facts: result.facts ?? [] });
        return;
      }

      prettyOutput.brandedHeader('Memory Query');
      prettyOutput.keyValue('Agent', agentId);
      prettyOutput.keyValue('Entries', String(result.entries.length));
      prettyOutput.keyValue('Facts', String(result.facts?.length ?? 0));
      prettyOutput.blank();

      if (result.entries.length === 0 && (!result.facts || result.facts.length === 0)) {
        prettyOutput.warn('No memory records found');
        prettyOutput.blank();
        return;
      }

      if (result.entries.length > 0) {
        prettyOutput.header('Entries');
        for (const entry of result.entries) {
          const tags = entry.tags && entry.tags.length > 0 ? ` tags=${entry.tags.join(',')}` : '';
          console.log(`  ${entry.id} [${entry.kind}]${tags}`);
          prettyOutput.indent(entry.content, 4);
        }
        prettyOutput.blank();
      }

      if (result.facts && result.facts.length > 0) {
        prettyOutput.header('Facts');
        for (const fact of result.facts) {
          console.log(`  ${fact.id} ${fact.subject} ${fact.predicate} ${fact.object}`);
        }
        prettyOutput.blank();
      }
    } finally {
      await stateLayer.close();
    }
  } catch (error) {
    output.error(error as Error);
  }
}

export async function memoryAppendEntryCommand(options: MemoryAppendEntryOptions): Promise<void> {
  const output = new OutputFormatter(options.json ?? false, 'memory append-entry', getVersion());

  try {
    const agentId = ensureValue(options.agentId, 'agent-id');
    const kind = parseKind(ensureValue(options.kind, 'kind'));
    const content = ensureValue(options.content, 'content');
    const tags = parseCsv(options.tags);
    const confidence = parseOptionalFloat(options.confidence, 'confidence');
    const expiresAt = options.expiresAt;

    const configPath = findConfigFileOrThrow();
    const config = loadAndValidateConfig({ configPath });
    const stateLayer = createStateLayerFromConfig(config);

    try {
      const now = new Date().toISOString();
      const entry: MemoryEntry = {
        id: randomUUID(),
        agentId,
        kind,
        content,
        tags,
        confidence,
        provenance: buildProvenance(options, options.provenanceFile),
        createdAt: now,
        updatedAt: now,
        expiresAt,
      };

      const stored = await stateLayer.appendMemoryEntry(
        entry,
        buildContext(config.security?.mode, options)
      );

      if (options.json) {
        output.success({ entry: stored });
        return;
      }

      prettyOutput.brandedHeader('Memory Entry Added');
      prettyOutput.keyValue('ID', stored.id);
      prettyOutput.keyValue('Kind', stored.kind);
      prettyOutput.blank();
    } finally {
      await stateLayer.close();
    }
  } catch (error) {
    output.error(error as Error);
  }
}

export async function memoryAppendFactCommand(options: MemoryAppendFactOptions): Promise<void> {
  const output = new OutputFormatter(options.json ?? false, 'memory append-fact', getVersion());

  try {
    const agentId = ensureValue(options.agentId, 'agent-id');
    const subject = ensureValue(options.subject, 'subject');
    const predicate = ensureValue(options.predicate, 'predicate');
    const object = ensureValue(options.object, 'object');
    const confidence = parseOptionalFloat(options.confidence, 'confidence');

    const configPath = findConfigFileOrThrow();
    const config = loadAndValidateConfig({ configPath });
    const stateLayer = createStateLayerFromConfig(config);

    try {
      const now = new Date().toISOString();
      const fact: MemoryFact = {
        id: randomUUID(),
        agentId,
        subject,
        predicate,
        object,
        confidence,
        sourceEntryId: options.sourceEntryId,
        createdAt: now,
      };

      const stored = await stateLayer.appendMemoryFacts(
        [fact],
        buildContext(config.security?.mode, options)
      );

      if (options.json) {
        output.success({ facts: stored });
        return;
      }

      prettyOutput.brandedHeader('Memory Fact Added');
      prettyOutput.keyValue('ID', fact.id);
      prettyOutput.blank();
    } finally {
      await stateLayer.close();
    }
  } catch (error) {
    output.error(error as Error);
  }
}

export async function memoryDeleteCommand(options: MemoryDeleteOptions): Promise<void> {
  const output = new OutputFormatter(options.json ?? false, 'memory delete', getVersion());

  try {
    const agentId = ensureValue(options.agentId, 'agent-id');
    const id = ensureValue(options.id, 'id');

    const configPath = findConfigFileOrThrow();
    const config = loadAndValidateConfig({ configPath });
    const stateLayer = createStateLayerFromConfig(config);

    try {
      await stateLayer.deleteMemoryEntry(id, agentId, buildContext(config.security?.mode, options));

      if (options.json) {
        output.success({ deleted: true, id });
        return;
      }

      prettyOutput.success(`Deleted memory entry ${id}`);
      prettyOutput.blank();
    } finally {
      await stateLayer.close();
    }
  } catch (error) {
    output.error(error as Error);
  }
}

function ensureValue(value: string | undefined, label: string): string {
  if (!value || value.trim().length === 0) {
    throw new CLIError(`Missing required --${label}`, 'MISSING_ARGUMENT', 2);
  }
  return value;
}

function parseCsv(value?: string): string[] | undefined {
  if (!value) return undefined;
  const entries = value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return entries.length > 0 ? entries : undefined;
}

function parseKind(value: string): MemoryKind {
  if (MEMORY_KINDS.includes(value as MemoryKind)) {
    return value as MemoryKind;
  }
  throw new CLIError(`Invalid memory kind: ${value}`, 'INVALID_KIND', 2);
}

function parseKinds(value?: string): MemoryKind[] | undefined {
  if (!value) return undefined;
  const kinds = parseCsv(value);
  if (!kinds || kinds.length === 0) {
    return undefined;
  }
  return kinds.map(parseKind);
}

function parseOptionalInt(value: string | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new CLIError(`Invalid ${label}: ${value}`, 'INVALID_NUMBER', 2);
  }
  return parsed;
}

function parseOptionalFloat(value: string | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed)) {
    throw new CLIError(`Invalid ${label}: ${value}`, 'INVALID_NUMBER', 2);
  }
  return parsed;
}

function buildContext(
  securityMode: StateOperationContext['securityMode'] | undefined,
  options: BaseMemoryOptions
): StateOperationContext {
  return {
    sessionId: options.sessionId ?? 'cli',
    userId: options.userId,
    securityMode: securityMode ?? 'standard',
    channel: 'cli',
    internalTool: true,
  };
}

function buildProvenance(
  options: BaseMemoryOptions & { source?: string },
  provenanceFile?: string
) {
  const source = options.source ?? 'cli';
  if (provenanceFile) {
    try {
      const raw = readFileSync(provenanceFile, 'utf-8');
      const parsed = JSON.parse(raw) as {
        source?: string;
        sessionId?: string;
        messageIds?: string[];
      };
      return {
        source: parsed.source ?? source,
        sessionId: parsed.sessionId ?? options.sessionId,
        messageIds: parsed.messageIds,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new CLIError(`Failed to read provenance file: ${message}`, 'INVALID_PROVENANCE', 2);
    }
  }

  return {
    source,
    sessionId: options.sessionId,
  };
}
