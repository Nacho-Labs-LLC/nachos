/**
 * Prompt Template Loader
 *
 * Utilities for loading and managing reusable prompt templates.
 */

import { readFile } from 'fs/promises';
import { join } from 'path';

export interface PromptTemplate {
  name: string;
  description: string;
  platform: string;
  tone: string;
  verbosity: string;
  content: string;
}

/**
 * Load a prompt template by name
 */
export async function loadTemplate(name: string): Promise<PromptTemplate> {
  const templatePath = join(__dirname, `${name}.md`);
  const raw = await readFile(templatePath, 'utf-8');

  // Parse frontmatter
  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
  const match = raw.match(frontmatterRegex);

  if (!match) {
    // No frontmatter, return raw content
    return {
      name,
      description: '',
      platform: 'any',
      tone: 'neutral',
      verbosity: 'balanced',
      content: raw,
    };
  }

  const frontmatter = parseFrontmatter(match[1] || '');
  const content = (match[2] || '').trim();

  return {
    name: frontmatter.name || name,
    description: frontmatter.description || '',
    platform: frontmatter.platform || 'any',
    tone: frontmatter.tone || 'neutral',
    verbosity: frontmatter.verbosity || 'balanced',
    content,
  };
}

/**
 * List available templates
 */
export async function listTemplates(): Promise<string[]> {
  const { readdir } = await import('fs/promises');
  const files = await readdir(__dirname);
  return files
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .map((f) => f.replace('.md', ''));
}

/**
 * Parse simple YAML-like frontmatter
 */
function parseFrontmatter(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = text.split('\n');

  for (const line of lines) {
    const match = line.match(/^(\w+):\s*(.+)$/);
    if (match) {
      result[match[1]!] = match[2]!.trim();
    }
  }

  return result;
}

/**
 * Template categories for organization
 */
export const TEMPLATE_CATEGORIES = {
  general: ['assistant-general', 'assistant-concise', 'assistant-verbose'],
  specialized: ['coding-assistant', 'research-assistant', 'data-analyst'],
  platform: ['discord-bot', 'telegram-bot', 'slack-bot'],
} as const;
