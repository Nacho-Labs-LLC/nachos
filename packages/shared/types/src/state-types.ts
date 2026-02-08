/**
 * State layer types for identity, memory, session state, and prompt reporting.
 */

export type IdentitySource = 'filesystem' | 'db' | 'api' | 'unknown';

export interface IdentityProfile {
  agentId: string;
  soul: string;
  identity: string;
  userProfile: string;
  toolsNotes?: string;
  updatedAt: string;
  version: number;
  source?: IdentitySource;
}

export type MemoryKind = 'summary' | 'preference' | 'fact' | 'decision' | 'task' | 'issue';

export interface MemoryEntry {
  id: string;
  agentId: string;
  kind: MemoryKind;
  content: string;
  tags?: string[];
  confidence?: number;
  provenance?: {
    source: string;
    sessionId?: string;
    messageIds?: string[];
  };
  createdAt: string;
  updatedAt?: string;
  expiresAt?: string;
}

export interface MemoryFact {
  id: string;
  agentId: string;
  subject: string;
  predicate: string;
  object: string;
  confidence?: number;
  sourceEntryId?: string;
  createdAt: string;
}

export interface MemoryQuery {
  agentId: string;
  kinds?: MemoryKind[];
  tags?: string[];
  text?: string;
  limit?: number;
  offset?: number;
}

export interface MemoryQueryResult {
  entries: MemoryEntry[];
  facts?: MemoryFact[];
}

export interface IdentityStore {
  get(agentId: string): Promise<IdentityProfile | null>;
  put(profile: IdentityProfile): Promise<IdentityProfile>;
  delete(agentId: string): Promise<void>;
}

export interface MemoryStore {
  appendEntry(entry: MemoryEntry): Promise<MemoryEntry>;
  appendFacts(facts: MemoryFact[]): Promise<MemoryFact[]>;
  query(query: MemoryQuery): Promise<MemoryQueryResult>;
  deleteEntry(id: string): Promise<void>;
}

export interface SessionStateRecord {
  sessionId: string;
  agentId: string;
  state: Record<string, unknown>;
  updatedAt: string;
  expiresAt?: string;
}

export interface SessionStateStore {
  get(sessionId: string): Promise<SessionStateRecord | null>;
  set(record: SessionStateRecord): Promise<SessionStateRecord>;
  touch(sessionId: string, ttlSeconds?: number): Promise<void>;
  delete(sessionId: string): Promise<void>;
}

export interface PromptSectionReport {
  name: string;
  sizeChars: number;
  sizeTokens?: number;
  hash?: string;
  source?: string;
}

export interface PromptReport {
  totalChars: number;
  totalTokens?: number;
  sections: PromptSectionReport[];
  generatedAt: string;
}

export interface PromptAssemblyResult {
  prompt: string;
  report: PromptReport;
}
