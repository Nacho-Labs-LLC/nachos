/**
 * Subagent workspace helpers.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createValidationError, createPermissionDeniedError } from '@nachos/types';

export interface SubagentWorkspaceEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size?: number;
  updatedAtMs?: number;
}

export interface SubagentWorkspaceReadResult {
  path: string;
  size: number;
  updatedAtMs: number;
  truncated: boolean;
  encoding: 'utf-8';
  content: string;
}

export function resolveSubagentWorkspaceRoot(baseDir?: string): string {
  const root = baseDir && baseDir.trim().length > 0 ? baseDir : './workspace';
  return path.resolve(root, 'subagents');
}

export async function ensureSubagentWorkspaceDir(rootDir: string, runId: string): Promise<string> {
  const dir = path.join(rootDir, runId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function listSubagentWorkspaceEntries(params: {
  rootDir: string;
  relativePath?: string;
  recursive?: boolean;
  limit?: number;
}): Promise<SubagentWorkspaceEntry[]> {
  const limit = Math.max(1, params.limit ?? 500);
  const targetDir = resolveWithinRoot(params.rootDir, params.relativePath ?? '.');
  const entries: SubagentWorkspaceEntry[] = [];

  const walk = async (dirPath: string): Promise<void> => {
    if (entries.length >= limit) return;
    const dirents = await fs.readdir(dirPath, { withFileTypes: true });
    for (const dirent of dirents) {
      if (entries.length >= limit) return;
      const fullPath = path.join(dirPath, dirent.name);
      const relative = normalizeRelative(params.rootDir, fullPath);
      if (!relative) {
        continue;
      }
      if (dirent.isDirectory()) {
        const stat = await fs.stat(fullPath);
        entries.push({
          name: dirent.name,
          path: relative,
          type: 'dir',
          updatedAtMs: Math.floor(stat.mtimeMs),
        });
        if (params.recursive) {
          await walk(fullPath);
        }
      } else if (dirent.isFile()) {
        const stat = await fs.stat(fullPath);
        entries.push({
          name: dirent.name,
          path: relative,
          type: 'file',
          size: stat.size,
          updatedAtMs: Math.floor(stat.mtimeMs),
        });
      }
    }
  };

  await walk(targetDir);
  return entries;
}

export async function readSubagentWorkspaceFile(params: {
  rootDir: string;
  relativePath: string;
  maxBytes?: number;
}): Promise<SubagentWorkspaceReadResult> {
  const targetPath = resolveWithinRoot(params.rootDir, params.relativePath);
  const stat = await fs.stat(targetPath);
  if (!stat.isFile()) {
    throw createValidationError('Requested path is not a file', { component: 'gateway' });
  }

  const limit = Math.max(1, params.maxBytes ?? 65536);
  const data = await fs.readFile(targetPath);
  const truncated = data.length > limit;
  const sliced = truncated ? data.subarray(0, limit) : data;

  return {
    path: normalizeRelative(params.rootDir, targetPath) ?? params.relativePath,
    size: stat.size,
    updatedAtMs: Math.floor(stat.mtimeMs),
    truncated,
    encoding: 'utf-8',
    content: sliced.toString('utf-8'),
  };
}

function resolveWithinRoot(rootDir: string, relativePath: string): string {
  const root = path.resolve(rootDir);
  const target = path.resolve(root, relativePath);
  const rel = path.relative(root, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw createPermissionDeniedError('Path escapes subagent workspace', { component: 'gateway' });
  }
  return target;
}

function normalizeRelative(rootDir: string, targetPath: string): string | null {
  const root = path.resolve(rootDir);
  const target = path.resolve(targetPath);
  const rel = path.relative(root, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return null;
  }
  return rel === '' ? '.' : rel;
}
