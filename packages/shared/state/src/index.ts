/**
 * @nachos/state — State layer for Nachos
 *
 * Identity, memory, bootstrap, user profiles, session state,
 * sessions (conversation history), and prompt assembly.
 */

export { StateLayer, createStateLayer, type StateOperationContext } from './state-layer.js';
export type {
  StateLayerConfig,
  StateLayerDependencies,
  StatePolicyRequest,
  StatePolicyDecision,
  StatePolicyCheck,
  StateAuditLogger,
  PromptAssemblyConfig,
  StateStoreSemanticConfig,
  StateStoreConfig,
  SessionStateConfig,
  SessionsStoreConfig,
  SessionsStoreSqliteConfig,
  SessionsStorePostgresConfig,
  StateStoreFilesystemConfig,
  StateStorePostgresConfig,
} from './types.js';
export {
  MemoryPipeline,
  type MemoryPipelineConfig,
  type MemoryPipelineTrigger,
} from './memory-pipeline.js';
export { createDefaultBootstrapBlocks } from './bootstrap/bootstrap-templates.js';
export { PromptAssembler, type PromptAssemblyParams } from './prompt/prompt-assembler.js';

// Sessions (conversation history) stores
export type {
  SessionsStore,
  CreateSessionData,
  UpdateSessionData,
  CreateMessageData,
  ISessionsStore,
} from './sessions/sessions-store-interface.js';
export { PostgresSessionsStore } from './sessions/postgres-sessions-store.js';
export { SqliteSessionsStore } from './sessions/sqlite-sessions-store.js';

// Memory stores
export { QdrantMemoryStore, type QdrantConfig } from './memory/qdrant-memory-store.js';
export {
  FilesystemMemoryStore,
  type FilesystemMemoryStoreConfig,
} from './memory/filesystem-memory-store.js';
