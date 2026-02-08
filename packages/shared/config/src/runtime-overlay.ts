/**
 * Runtime configuration overlay
 *
 * Provides a JSON-based overlay stored in the runtime state directory.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { NachosConfig, PartialNachosConfig } from './schema.js';

const OVERLAY_FILENAME = 'channel-config-overrides.json';

function isSafeKey(key: string): boolean {
  return key !== '__proto__' && key !== 'constructor' && key !== 'prototype';
}

function deepMergeRecords(
  target: Record<string, unknown>,
  source: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };

  for (const key in source) {
    if (!isSafeKey(key)) continue;

    const sourceValue = source[key];
    const targetValue = result[key];

    if (sourceValue !== undefined) {
      if (
        typeof sourceValue === 'object' &&
        sourceValue !== null &&
        !Array.isArray(sourceValue) &&
        typeof targetValue === 'object' &&
        targetValue !== null &&
        !Array.isArray(targetValue)
      ) {
        result[key] = deepMergeRecords(
          targetValue as Record<string, unknown>,
          sourceValue as Record<string, unknown>
        );
      } else {
        result[key] = sourceValue;
      }
    }
  }

  return result;
}

export function resolveRuntimeStateDir(config?: NachosConfig): string {
  return (
    process.env.RUNTIME_STATE_DIR ||
    process.env.NACHOS_STATE_DIR ||
    config?.runtime?.state_dir ||
    './state'
  );
}

export function getRuntimeOverlayPath(stateDir: string): string {
  return path.join(stateDir, OVERLAY_FILENAME);
}

export function loadRuntimeOverlay(stateDir: string): PartialNachosConfig {
  const filePath = getRuntimeOverlayPath(stateDir);
  if (!fs.existsSync(filePath)) {
    return {} as PartialNachosConfig;
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return {} as PartialNachosConfig;
    }
    return parsed as PartialNachosConfig;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[Config] Failed to load runtime overlay: ${message}`);
    return {} as PartialNachosConfig;
  }
}

export function saveRuntimeOverlay(stateDir: string, overlay: PartialNachosConfig): void {
  const filePath = getRuntimeOverlayPath(stateDir);
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(overlay, null, 2), 'utf-8');
}

export function applyRuntimeOverlay(
  config: NachosConfig,
  overlay?: PartialNachosConfig
): NachosConfig {
  const resolvedOverlay = overlay ?? loadRuntimeOverlay(resolveRuntimeStateDir(config));
  const merged = deepMergeRecords(
    config as unknown as Record<string, unknown>,
    resolvedOverlay as unknown as Record<string, unknown>
  );
  return merged as unknown as NachosConfig;
}
