/**
 * Known context window sizes (in tokens) for Claude and common models.
 *
 * Source: https://docs.anthropic.com/en/docs/about-claude/models/overview
 * Last verified: 2026-03-14
 *
 * When a model isn't in this map, callers should fall back to a safe default.
 */

const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  // ── Claude 4.6 (current) ──────────────────────────────────────────
  'claude-opus-4-6': 1_000_000,
  'claude-sonnet-4-6': 1_000_000,

  // ── Claude 4.5 ────────────────────────────────────────────────────
  // Sonnet 4.5 supports 1M with beta header, defaults to 200k
  'claude-sonnet-4-5': 200_000,
  'claude-sonnet-4-5-20250929': 200_000,
  'claude-opus-4-5': 200_000,
  'claude-opus-4-5-20251101': 200_000,

  // ── Claude 4.1 ────────────────────────────────────────────────────
  'claude-opus-4-1': 200_000,
  'claude-opus-4-1-20250805': 200_000,

  // ── Claude 4.0 ────────────────────────────────────────────────────
  // Sonnet 4.0 supports 1M with beta header, defaults to 200k
  'claude-sonnet-4-0': 200_000,
  'claude-sonnet-4-20250514': 200_000,
  'claude-opus-4-0': 200_000,
  'claude-opus-4-20250514': 200_000,

  // ── Claude Haiku ──────────────────────────────────────────────────
  'claude-haiku-4-5': 200_000,
  'claude-haiku-4-5-20251001': 200_000,
  'claude-3-haiku-20240307': 200_000,
};

/** Default context window when model is unknown */
export const DEFAULT_CONTEXT_WINDOW = 200_000;

/**
 * Look up the context window size for a model.
 *
 * Handles exact matches and prefix matches (e.g. "claude-sonnet-4-6-20260101"
 * matches the "claude-sonnet-4-6" entry).
 *
 * @param model  Model ID string (e.g. "claude-sonnet-4-6")
 * @param configOverride  Explicit override from nachos.toml `llm.context_window`
 * @returns Context window size in tokens
 */
export function getModelContextWindow(model?: string, configOverride?: number): number {
  // Explicit config override always wins
  if (configOverride && configOverride > 0) {
    return configOverride;
  }

  if (!model) {
    return DEFAULT_CONTEXT_WINDOW;
  }

  // Exact match
  if (model in MODEL_CONTEXT_WINDOWS) {
    return MODEL_CONTEXT_WINDOWS[model]!;
  }

  // Prefix match: "claude-opus-4-6-20260301" → "claude-opus-4-6"
  for (const [key, value] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
    if (model.startsWith(key)) {
      return value;
    }
  }

  return DEFAULT_CONTEXT_WINDOW;
}
