/**
 * @nachos/state — State layer for Nachos
 *
 * Identity, memory, bootstrap, user profiles, session state,
 * and prompt assembly.
 */

export {
  StateLayer,
  createStateLayer,
  type StateOperationContext,
} from './state-layer.js';
export type {
  StateLayerConfig,
  StateLayerDependencies,
  StatePolicyRequest,
  StatePolicyDecision,
  StatePolicyCheck,
  StateAuditLogger,
  PromptAssemblyConfig,
} from './types.js';
export {
  MemoryPipeline,
  type MemoryPipelineConfig,
  type MemoryPipelineTrigger,
} from './memory-pipeline.js';
export { createDefaultBootstrapBlocks } from './bootstrap/bootstrap-templates.js';
export { PromptAssembler, type PromptAssemblyParams } from './prompt/prompt-assembler.js';
