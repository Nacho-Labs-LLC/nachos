/**
 * Skill Loader
 *
 * Loads SKILL.md files and formats them for inclusion in LLM system prompt.
 * Skills provide CLI tool documentation and usage examples.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Parsed skill metadata from frontmatter
 */
export interface SkillMetadata {
  name: string;
  description: string;
  homepage?: string;
  nachos?: {
    requires?: {
      bins?: string[];
      env?: string[];
    };
    primaryEnv?: string;
  };
}

/**
 * Loaded skill
 */
export interface Skill {
  name: string;
  metadata: SkillMetadata;
  content: string; // Full markdown content (without frontmatter)
  filePath: string;
}

/**
 * Skill loader configuration
 */
export interface SkillLoaderConfig {
  /** Directory containing skills */
  skillsDir: string;
  /** Tool groups to filter skills by (if undefined, load all) */
  toolGroups?: string[];
}

/**
 * Parse YAML-like frontmatter from markdown
 */
function parseFrontmatter(content: string): {
  metadata: Partial<SkillMetadata>;
  content: string;
} {
  // Normalize line endings to LF for consistent parsing
  const normalizedContent = content.replace(/\r\n/g, '\n');

  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
  const match = normalizedContent.match(frontmatterRegex);

  if (!match || !match[1] || !match[2]) {
    return { metadata: {}, content: normalizedContent };
  }

  const frontmatterText = match[1];
  const markdownContent = match[2];
  const metadata: Partial<SkillMetadata> = {};

  // Parse simple YAML-like format
  const lines = frontmatterText.split('\n');
  for (const line of lines) {
    const nameMatch = line.match(/^name:\s*(.+)$/);
    if (nameMatch && nameMatch[1]) {
      metadata.name = nameMatch[1].trim();
      continue;
    }

    const descMatch = line.match(/^description:\s*(.+)$/);
    if (descMatch && descMatch[1]) {
      metadata.description = descMatch[1].trim();
      continue;
    }

    const homepageMatch = line.match(/^homepage:\s*(.+)$/);
    if (homepageMatch && homepageMatch[1]) {
      metadata.homepage = homepageMatch[1].trim();
      continue;
    }

    const metadataMatch = line.match(/^metadata:\s*(.+)$/);
    if (metadataMatch && metadataMatch[1]) {
      try {
        const metaObj = JSON.parse(metadataMatch[1]);
        if (metaObj.nachos) {
          metadata.nachos = metaObj.nachos;
        }
      } catch {
        // Ignore parse errors
      }
    }
  }

  return { metadata, content: markdownContent.trim() };
}

/**
 * Load skills from directory
 */
export function loadSkills(config: SkillLoaderConfig): Skill[] {
  const skills: Skill[] = [];

  try {
    const entries = readdirSync(config.skillsDir);

    for (const entry of entries) {
      const skillPath = join(config.skillsDir, entry);
      const stat = statSync(skillPath);

      if (!stat.isDirectory()) {
        continue;
      }

      // Look for SKILL.md in the directory
      const skillFile = join(skillPath, 'SKILL.md');
      try {
        const content = readFileSync(skillFile, 'utf-8');
        const { metadata, content: markdownContent } = parseFrontmatter(content);

        if (!metadata.name) {
          console.warn(`[SkillLoader] Skill at ${skillFile} missing name in frontmatter`);
          continue;
        }

        // Filter by tool groups if specified
        if (config.toolGroups && config.toolGroups.length > 0) {
          const bins = metadata.nachos?.requires?.bins || [];
          const matchesGroup = bins.some((bin) => {
            // Check if any tool group contains this bin
            // This is a simple check - the gateway has the actual mapping
            return config.toolGroups?.includes(bin);
          });

          if (!matchesGroup) {
            continue;
          }
        }

        skills.push({
          name: metadata.name,
          metadata: metadata as SkillMetadata,
          content: markdownContent,
          filePath: skillFile,
        });
      } catch {
        // Skill file doesn't exist or can't be read, skip
        continue;
      }
    }

    return skills;
  } catch (error) {
    console.error('[SkillLoader] Failed to load skills:', error);
    return [];
  }
}

/**
 * Format skills for LLM system prompt
 */
export function formatSkillsForPrompt(skills: Skill[]): string {
  if (skills.length === 0) {
    return '';
  }

  const sections: string[] = [
    '# Available CLI Tools (Skills)',
    '',
    'You have access to the following CLI tools via the `exec` tool. Each tool is a specialized command-line utility.',
    '',
  ];

  for (const skill of skills) {
    sections.push(`## ${skill.name}`);
    sections.push('');
    if (skill.metadata.description) {
      sections.push(skill.metadata.description);
      sections.push('');
    }
    if (skill.metadata.homepage) {
      sections.push(`**Homepage**: ${skill.metadata.homepage}`);
      sections.push('');
    }

    // Add required environment variables if specified
    if (skill.metadata.nachos?.requires?.env) {
      sections.push('**Required Environment Variables**:');
      for (const envVar of skill.metadata.nachos.requires.env) {
        sections.push(`- \`${envVar}\``);
      }
      sections.push('');
    }

    // Add the skill content (usage examples, etc.)
    sections.push(skill.content);
    sections.push('');
    sections.push('---');
    sections.push('');
  }

  sections.push('## Using Skills');
  sections.push('');
  sections.push('To use any of these tools, call the `exec` tool with the command:');
  sections.push('');
  sections.push('```json');
  sections.push('{');
  sections.push('  "tool": "exec",');
  sections.push('  "parameters": {');
  sections.push('    "command": "goplaces search \\"coffee\\" --limit 5"');
  sections.push('  }');
  sections.push('}');
  sections.push('```');
  sections.push('');

  return sections.join('\n');
}

/**
 * Get list of tool binaries from loaded skills
 */
export function getSkillBinaries(skills: Skill[]): string[] {
  const binaries = new Set<string>();

  for (const skill of skills) {
    const bins = skill.metadata.nachos?.requires?.bins || [];
    for (const bin of bins) {
      binaries.add(bin);
    }
  }

  return Array.from(binaries);
}
