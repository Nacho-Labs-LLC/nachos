/**
 * State layer types for identity, memory, session state, and prompt reporting.
 */

export type IdentitySource = 'filesystem' | 'db' | 'api' | 'unknown' | 'default';

export type BootstrapBlockMap = Record<string, string>;

export interface IdentityProfile {
  agentId: string;
  soul: string;
  identity: string;
  userProfile: string;
  toolsNotes?: string;
  identityCompleted?: boolean;
  identityCompletedAt?: string;
  updatedAt: string;
  version: number;
  source?: IdentitySource;
}

export interface BootstrapProfile {
  agentId: string;
  content: BootstrapBlockMap;
  updatedAt: string;
  version: number;
  source?: IdentitySource;
}

export type MemoryKind =
  | 'summary'
  | 'preference'
  | 'fact'
  | 'decision'
  | 'task'
  | 'issue'
  | 'note'
  | 'lesson';

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

export type MemoryFactType =
  | 'attribute'
  | 'relationship'
  | 'preference'
  | 'skill'
  | 'event'
  | 'general';

export interface MemoryFact {
  id: string;
  agentId: string;
  subject: string;
  predicate: string;
  object: string;
  type?: MemoryFactType;
  confidence?: number;
  properties?: Record<string, unknown>;
  sourceEntryId?: string;
  sourceContext?: string;
  createdAt: string;
  updatedAt?: string;
  expiresAt?: string;
}

export interface UserProfile {
  userId: string;
  agentId: string;
  profile: string;
  updatedAt: string;
  version: number;
  source?: IdentitySource;
}

export interface WorkspaceDocument {
  id: string;
  path: string;
  contentHash: string;
  projectId?: string;
  metadata?: Record<string, unknown>;
  chunkCount: number;
  lastIndexed: string;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentChunk {
  id: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  tokenCount?: number;
  createdAt: string;
}

export interface MemoryQuery {
  agentId: string;
  kinds?: MemoryKind[];
  tags?: string[];
  text?: string;
  limit?: number;
  offset?: number;
  semantic?: boolean;
  minSimilarity?: number;
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
  deleteEntry(id: string, agentId: string): Promise<void>;
  /**
   * Query facts by agentId and optional subject filter.
   * Used for deduplication before inserting new extracted facts.
   */
  queryFacts(agentId: string, subject?: string): Promise<MemoryFact[]>;
  /**
   * Update an existing fact (used for dedup — bumps confidence and merges properties).
   * If the fact does not exist, does nothing.
   */
  updateFact(fact: MemoryFact): Promise<MemoryFact | null>;
}

export interface BootstrapStore {
  get(agentId: string): Promise<BootstrapProfile | null>;
  put(profile: BootstrapProfile): Promise<BootstrapProfile>;
  delete(agentId: string): Promise<void>;
}

export interface UserProfileStore {
  get(agentId: string, userId: string): Promise<UserProfile | null>;
  put(profile: UserProfile): Promise<UserProfile>;
  delete(agentId: string, userId: string): Promise<void>;
}

export interface WorkspaceDocumentQuery {
  projectId?: string;
  path?: string;
  limit?: number;
  offset?: number;
}

export interface WorkspaceDocumentStore {
  indexDocument(doc: WorkspaceDocument, chunks: DocumentChunk[]): Promise<WorkspaceDocument>;
  getDocument(id: string): Promise<WorkspaceDocument | null>;
  getDocumentByPath(path: string, projectId?: string): Promise<WorkspaceDocument | null>;
  getChunks(documentId: string): Promise<DocumentChunk[]>;
  removeDocument(id: string): Promise<boolean>;
  listDocuments(query?: WorkspaceDocumentQuery): Promise<WorkspaceDocument[]>;
  close(): Promise<void>;
}

/** Maximum allowed size for a serialized SessionStateRecord.state value (100 KB). */
export const MAX_SESSION_STATE_SIZE_BYTES = 102400;

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
  /**
   * Extend the TTL of a session state record.
   * Returns `{ touched: true }` if the key existed and was refreshed.
   * Returns `{ touched: false }` if the key was missing or already expired.
   */
  touch(sessionId: string, ttlSeconds?: number): Promise<{ touched: boolean }>;
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
