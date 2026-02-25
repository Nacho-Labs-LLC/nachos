/**
 * Model selection logic for subagents
 * 
 * Provides intelligent model routing based on task complexity,
 * user hints, and configured aliases.
 */

/**
 * Default model aliases (Bedrock format)
 */
export const DEFAULT_MODEL_ALIASES: Record<string, string> = {
  // Claude 3 Haiku - Fast and economical
  'haiku': 'anthropic.claude-3-haiku-20240307-v1:0',
  
  // Claude 3.5 Sonnet - Balanced performance
  'sonnet': 'anthropic.claude-3-5-sonnet-20241022-v2:0',
  'balanced': 'anthropic.claude-3-5-sonnet-20241022-v2:0',
  
  // Claude 3 Opus - Maximum capability
  'opus': 'anthropic.claude-3-opus-20240229-v1:0',
  'thorough': 'anthropic.claude-3-opus-20240229-v1:0',
  
  // Convenience aliases
  'fast': 'anthropic.claude-3-haiku-20240307-v1:0',
  'cheap': 'anthropic.claude-3-haiku-20240307-v1:0',
  'default': 'anthropic.claude-3-5-sonnet-20241022-v2:0',
};

/**
 * Model hints for auto-selection
 */
export type ModelHint = 'fast' | 'balanced' | 'thorough';

/**
 * Configuration for model selection
 */
export interface ModelSelectionConfig {
  /** Custom model aliases (overrides defaults) */
  aliases?: Record<string, string>;
  /** Enable automatic model selection based on task complexity */
  autoSelect?: boolean;
  /** Default model when no hint or auto-selection */
  defaultModel?: string;
}

/**
 * Task complexity indicators
 */
interface ComplexityIndicators {
  wordCount: number;
  hasCodeAnalysis: boolean;
  hasMultipleSteps: boolean;
  estimatedLength: 'short' | 'medium' | 'long';
}

/**
 * Analyze task complexity
 */
function analyzeTaskComplexity(task: string): ComplexityIndicators {
  const wordCount = task.split(/\s+/).length;
  
  // Keywords that suggest complex analysis
  const complexKeywords = [
    'analyze', 'review', 'audit', 'investigate', 'comprehensive',
    'detailed', 'thorough', 'research', 'compare', 'evaluate'
  ];
  
  // Keywords that suggest code analysis
  const codeKeywords = [
    'codebase', 'repository', 'vulnerabilities', 
    'refactor', 'optimize', 'bugs'
  ];
  
  // Keywords that suggest multi-step work
  const multiStepKeywords = [
    'then', 'after', 'following', 'next', 'finally', 'steps',
    'first', 'second', 'third', 'and then'
  ];
  
  const taskLower = task.toLowerCase();
  
  const hasComplexKeywords = complexKeywords.some(kw => taskLower.includes(kw));
  const hasCodeKeywords = codeKeywords.some(kw => taskLower.includes(kw));
  const hasCodeAnalysis = hasComplexKeywords || hasCodeKeywords;
  
  const hasMultipleSteps = multiStepKeywords.some(kw => taskLower.includes(kw)) ||
                           (task.match(/\d+\./g)?.length ?? 0) > 1; // Numbered lists
  
  let estimatedLength: 'short' | 'medium' | 'long';
  if (wordCount < 8) {
    estimatedLength = 'short';
  } else if (wordCount < 40) {
    estimatedLength = 'medium';
  } else {
    estimatedLength = 'long';
  }
  
  return {
    wordCount,
    hasCodeAnalysis,
    hasMultipleSteps,
    estimatedLength,
  };
}

/**
 * Auto-select model based on task complexity
 */
function autoSelectModel(task: string, config: ModelSelectionConfig): string {
  const complexity = analyzeTaskComplexity(task);
  const aliases = { ...DEFAULT_MODEL_ALIASES, ...config.aliases };
  
  // Code analysis or multi-step work → Opus (keywords trump length)
  if (complexity.hasCodeAnalysis || complexity.hasMultipleSteps) {
    return aliases['thorough'] ?? DEFAULT_MODEL_ALIASES['thorough']!;
  }
  
  // Long tasks → Opus
  if (complexity.estimatedLength === 'long') {
    return aliases['thorough'] ?? DEFAULT_MODEL_ALIASES['thorough']!;
  }
  
  // Short, simple tasks → Haiku
  if (complexity.estimatedLength === 'short') {
    return aliases['fast'] ?? DEFAULT_MODEL_ALIASES['fast']!;
  }
  
  // Medium complexity → Sonnet (default)
  return aliases['balanced'] ?? DEFAULT_MODEL_ALIASES['balanced']!;
}

/**
 * Resolve model alias to full model ID
 */
function resolveAlias(alias: string, config: ModelSelectionConfig): string {
  const aliases = { ...DEFAULT_MODEL_ALIASES, ...config.aliases };
  const lowerAlias = alias.toLowerCase();
  
  // If it's an alias, resolve it
  if (aliases[lowerAlias]) {
    return aliases[lowerAlias]!;
  }
  
  // If it's already a full model ID (contains dots), use as-is
  if (alias.includes('.') || alias.startsWith('anthropic.') || alias.startsWith('claude-')) {
    return alias;
  }
  
  // Unknown alias, return as-is (will fail validation later)
  return alias;
}

/**
 * Select model for a subagent task
 * 
 * Priority order:
 * 1. Explicit model parameter (if provided)
 * 2. Model hint (fast/balanced/thorough)
 * 3. Auto-selection based on task complexity (if enabled)
 * 4. Default model from config
 * 5. Fallback to Sonnet
 */
export function selectModel(
  task: string,
  options: {
    model?: string;
    modelHint?: ModelHint;
  },
  config: ModelSelectionConfig = {}
): string {
  // 1. Explicit model takes precedence
  if (options.model) {
    return resolveAlias(options.model, config);
  }
  
  // 2. Model hint
  if (options.modelHint) {
    const aliases = { ...DEFAULT_MODEL_ALIASES, ...config.aliases };
    return aliases[options.modelHint] ?? DEFAULT_MODEL_ALIASES[options.modelHint]!;
  }
  
  // 3. Auto-selection (if enabled)
  if (config.autoSelect === true) {
    return autoSelectModel(task, config);
  }
  
  // 4. Default model from config
  if (config.defaultModel) {
    return resolveAlias(config.defaultModel, config);
  }
  
  // 5. Fallback to Sonnet
  return DEFAULT_MODEL_ALIASES['balanced']!;
}

/**
 * Get human-readable model name from model ID
 */
export function getModelName(modelId: string): string {
  if (modelId.includes('haiku')) return 'Claude 3 Haiku';
  if (modelId.includes('sonnet')) return 'Claude 3.5 Sonnet';
  if (modelId.includes('opus')) return 'Claude 3 Opus';
  return modelId;
}

/**
 * Estimate relative cost multiplier for a model
 * Base cost = 1.0 (Haiku)
 */
export function getModelCostMultiplier(modelId: string): number {
  if (modelId.includes('haiku')) return 1.0;
  if (modelId.includes('sonnet')) return 12.0; // ~12x more expensive than Haiku
  if (modelId.includes('opus')) return 60.0; // ~60x more expensive than Haiku
  return 1.0;
}
