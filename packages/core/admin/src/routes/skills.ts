import { Hono } from 'hono';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SkillEntry, SkillsResponse } from '../types.js';

const SKILLS_DIR = process.env['NACHOS_SKILLS_DIR'] ?? '/app/skills';
const CONFIG_PATH = process.env['NACHOS_CONFIG_PATH'] ?? '/app/nachos.toml';

export const skillsRouter = new Hono();

interface SkillFrontmatter {
  homepage?: string;
  [key: string]: unknown;
}

function parseFrontmatter(content: string): { frontmatter: SkillFrontmatter; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };

  const fm: SkillFrontmatter = {};
  const fmBlock = match[1] ?? '';
  const body = match[2] ?? '';
  for (const line of fmBlock.split('\n')) {
    const idx = line.indexOf(':');
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim();
      fm[key] = val;
    }
  }
  return { frontmatter: fm, body };
}

function parseSkillMd(content: string): { name: string; description: string; homepage?: string } {
  const { frontmatter, body } = parseFrontmatter(content);

  // Extract name from first H1
  const h1Match = body.match(/^#\s+(.+)/m);
  const name = h1Match?.[1]?.trim() ?? 'Unknown';

  // Extract description from first paragraph after H1
  let description = '';
  if (h1Match) {
    const afterH1 = body.slice((h1Match.index ?? 0) + h1Match[0].length).trim();
    const lines = afterH1.split('\n');
    const paraLines: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '') {
        if (paraLines.length > 0) break;
        continue;
      }
      if (trimmed.startsWith('#')) break;
      paraLines.push(trimmed);
    }
    description = paraLines.join(' ');
  }

  return {
    name,
    description,
    homepage: typeof frontmatter.homepage === 'string' ? frontmatter.homepage : undefined,
  };
}

interface TomlSkillsConfig {
  skills?: {
    allow?: string[];
    deny?: string[];
    entries?: Record<string, { enabled?: boolean }>;
  };
}

function loadTomlConfig(): TomlSkillsConfig {
  if (!existsSync(CONFIG_PATH)) return {};

  try {
    // Dynamic import would be async; use require-style for sync toml parsing
    // Simple TOML parser for the skills section only
    const content = readFileSync(CONFIG_PATH, 'utf-8');
    const config: TomlSkillsConfig = { skills: { allow: [], deny: [], entries: {} } };

    let inSkills = false;
    let inEntries = false;
    let currentEntry = '';

    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '[skills]') {
        inSkills = true;
        inEntries = false;
        continue;
      }
      if (trimmed === '[skills.entries]' || trimmed.startsWith('[skills.entries.')) {
        inSkills = false;
        inEntries = true;
        const entryMatch = trimmed.match(/\[skills\.entries\.(.+)\]/);
        if (entryMatch?.[1]) currentEntry = entryMatch[1];
        continue;
      }
      if (trimmed.startsWith('[') && !trimmed.startsWith('[skills')) {
        inSkills = false;
        inEntries = false;
        continue;
      }

      if (inSkills && config.skills) {
        const kv = trimmed.match(/^(\w+)\s*=\s*\[(.*)]/);
        if (kv?.[1] && kv[2] !== undefined) {
          const key = kv[1] as 'allow' | 'deny';
          const vals = kv[2]
            .split(',')
            .map((s) => s.trim().replace(/^["']|["']$/g, ''))
            .filter(Boolean);
          if (key === 'allow' || key === 'deny') config.skills[key] = vals;
        }
      }

      if (inEntries && currentEntry && config.skills?.entries) {
        const kv = trimmed.match(/^enabled\s*=\s*(true|false)/);
        if (kv?.[1]) {
          config.skills.entries[currentEntry] = { enabled: kv[1] === 'true' };
        }
      }
    }

    return config;
  } catch {
    return {};
  }
}

skillsRouter.get('/', (c) => {
  if (!existsSync(SKILLS_DIR)) {
    const empty: SkillsResponse = { skills: [] };
    return c.json(empty);
  }

  try {
    const dirs = readdirSync(SKILLS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory());
    const config = loadTomlConfig();
    const allow = config.skills?.allow;
    const deny = config.skills?.deny ?? [];
    const entries = config.skills?.entries ?? {};

    const skills: SkillEntry[] = [];

    for (const dir of dirs) {
      const mdPath = join(SKILLS_DIR, dir.name, 'SKILL.md');
      if (!existsSync(mdPath)) continue;

      const content = readFileSync(mdPath, 'utf-8');
      const parsed = parseSkillMd(content);

      let status: SkillEntry['status'] = 'active';
      let reason: string | undefined;

      if (deny.includes(dir.name)) {
        status = 'denied';
        reason = 'Listed in skills.deny';
      } else if (allow && allow.length > 0 && !allow.includes(dir.name)) {
        status = 'denied';
        reason = 'Not in skills.allow list';
      } else if (entries[dir.name]?.enabled === false) {
        status = 'disabled';
        reason = 'Disabled in skills.entries';
      }

      skills.push({
        name: parsed.name,
        description: parsed.description,
        status,
        reason,
        homepage: parsed.homepage,
      });
    }

    const response: SkillsResponse = { skills };
    return c.json(response);
  } catch (err) {
    return c.json({ error: 'Failed to read skills', details: String(err) }, 500);
  }
});
