import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadSkills, formatSkillsForPrompt, filterSkillsForPrompt } from './skill-loader.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('SkillLoader', () => {
  let tempDir: string;

  beforeEach(() => {
    // Create temporary directory for test skills
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nachos-skills-test-'));
  });

  afterEach(() => {
    // Clean up temporary directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('loadSkills', () => {
    it('should load skills from valid SKILL.md files', () => {
      // Create test skill directory
      const skillDir = path.join(tempDir, 'test-skill');
      fs.mkdirSync(skillDir);

      // Create SKILL.md with frontmatter
      const skillContent = `---
name: test-skill
description: A test skill
homepage: https://example.com/test-skill
metadata: {"nachos":{"requires":{"bins":["test-bin"],"env":["TEST_API_KEY"]}}}
---

# test-skill

## Usage

\`\`\`bash
test-bin --help
\`\`\`
`;

      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillContent);

      const skills = loadSkills({ skillsDir: tempDir });

      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe('test-skill');
      expect(skills[0].metadata.description).toBe('A test skill');
      expect(skills[0].metadata.homepage).toBe('https://example.com/test-skill');
      expect(skills[0].metadata.nachos).toBeDefined();
      expect(skills[0].metadata.nachos?.requires?.bins).toEqual(['test-bin']);
      expect(skills[0].content).toContain('# test-skill');
      expect(skills[0].content).toContain('test-bin --help');
    });

    it('should skip skills without name in frontmatter', () => {
      const skillDir = path.join(tempDir, 'simple-skill');
      fs.mkdirSync(skillDir);

      const skillContent = `# Simple Skill

Just a simple markdown file without frontmatter.
`;

      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillContent);

      const skills = loadSkills({ skillsDir: tempDir });

      // Skills without a name in frontmatter are skipped
      expect(skills).toHaveLength(0);
    });

    it('should skip directories without SKILL.md', () => {
      const skillDir = path.join(tempDir, 'no-skill-file');
      fs.mkdirSync(skillDir);
      fs.writeFileSync(path.join(skillDir, 'README.md'), '# Not a skill');

      const skills = loadSkills({ skillsDir: tempDir });

      expect(skills).toHaveLength(0);
    });

    it('should handle multiple skills', () => {
      // Create skill 1
      const skill1Dir = path.join(tempDir, 'skill1');
      fs.mkdirSync(skill1Dir);
      fs.writeFileSync(path.join(skill1Dir, 'SKILL.md'), '---\nname: skill1\n---\n# Skill 1');

      // Create skill 2
      const skill2Dir = path.join(tempDir, 'skill2');
      fs.mkdirSync(skill2Dir);
      fs.writeFileSync(path.join(skill2Dir, 'SKILL.md'), '---\nname: skill2\n---\n# Skill 2');

      const skills = loadSkills({ skillsDir: tempDir });

      expect(skills).toHaveLength(2);
      const skillNames = skills.map((s) => s.name);
      expect(skillNames).toContain('skill1');
      expect(skillNames).toContain('skill2');
    });

    it('should return empty array for non-existent directory', () => {
      const skills = loadSkills({ skillsDir: path.join(tempDir, 'nonexistent') });
      expect(skills).toEqual([]);
    });

    it('should handle malformed frontmatter gracefully', () => {
      const skillDir = path.join(tempDir, 'malformed');
      fs.mkdirSync(skillDir);

      const skillContent = `---
name: malformed
metadata: {invalid json here
---
# Malformed Skill
`;

      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillContent);

      const skills = loadSkills({ skillsDir: tempDir });

      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe('malformed');
      expect(skills[0].metadata.nachos).toBeUndefined();
    });
  });

  describe('formatSkillsForPrompt', () => {
    it('should format skills with proper markdown structure', () => {
      const skills = [
        {
          name: 'goplaces',
          metadata: {
            name: 'goplaces',
            description: 'Google Places API search',
            homepage: 'https://github.com/steipete/goplaces',
          },
          content: '# goplaces\n\n## Usage\n\n```bash\ngoplaces search "coffee"\n```',
          filePath: '/test/goplaces/SKILL.md',
        },
      ];

      const formatted = formatSkillsForPrompt(skills);

      expect(formatted).toContain('# Available CLI Tools (Skills)');
      expect(formatted).toContain('## goplaces');
      expect(formatted).toContain('Google Places API search');
      expect(formatted).toContain('https://github.com/steipete/goplaces');
      expect(formatted).toContain('goplaces search "coffee"');
      expect(formatted).toContain('## Using Skills');
      expect(formatted).toContain('"tool": "exec"');
    });

    it('should handle multiple skills', () => {
      const skills = [
        {
          name: 'skill1',
          metadata: { name: 'skill1', description: 'First skill' },
          content: '# Skill 1',
          filePath: '/test/skill1/SKILL.md',
        },
        {
          name: 'skill2',
          metadata: { name: 'skill2', description: 'Second skill' },
          content: '# Skill 2',
          filePath: '/test/skill2/SKILL.md',
        },
      ];

      const formatted = formatSkillsForPrompt(skills);

      expect(formatted).toContain('## skill1');
      expect(formatted).toContain('First skill');
      expect(formatted).toContain('## skill2');
      expect(formatted).toContain('Second skill');
    });

    it('should return empty string for empty skills array', () => {
      const formatted = formatSkillsForPrompt([]);
      expect(formatted).toBe('');
    });

    it('should handle skills without homepage', () => {
      const skills = [
        {
          name: 'no-homepage',
          metadata: { name: 'no-homepage', description: 'Test skill' },
          content: '# Test',
          filePath: '/test/no-homepage/SKILL.md',
        },
      ];

      const formatted = formatSkillsForPrompt(skills);

      expect(formatted).toContain('## no-homepage');
      expect(formatted).toContain('Test skill');
      expect(formatted).not.toContain('Homepage:');
    });

    it('should escape markdown special characters in metadata', () => {
      const skills = [
        {
          name: 'special',
          metadata: {
            name: 'special',
            description: 'Description with **bold** and *italic*',
          },
          content: '# Special',
          filePath: '/test/special/SKILL.md',
        },
      ];

      const formatted = formatSkillsForPrompt(skills);

      // Description should be preserved as-is (markdown is allowed)
      expect(formatted).toContain('Description with **bold** and *italic*');
    });

    it('should include separators between skills', () => {
      const skills = [
        {
          name: 'skill1',
          metadata: { name: 'skill1' },
          content: '# Skill 1',
          filePath: '/test/skill1/SKILL.md',
        },
        {
          name: 'skill2',
          metadata: { name: 'skill2' },
          content: '# Skill 2',
          filePath: '/test/skill2/SKILL.md',
        },
      ];

      const formatted = formatSkillsForPrompt(skills);

      // Should have separators (---) between skills
      expect(formatted).toContain('---');
    });
  });

  describe('filterSkillsForPrompt', () => {
    it('should filter by allowlist, denylist, and requirements', () => {
      const skills = [
        {
          name: 'allowed',
          metadata: {
            name: 'allowed',
            description: 'Allowed',
            nachos: {
              requires: { bins: ['bin1'], env: ['TEST_KEY'] },
            },
          },
          content: '# Allowed',
          filePath: '/test/allowed/SKILL.md',
        },
        {
          name: 'denied',
          metadata: { name: 'denied', description: 'Denied' },
          content: '# Denied',
          filePath: '/test/denied/SKILL.md',
        },
      ];

      const filtered = filterSkillsForPrompt(skills, {
        allow: ['allowed', 'denied'],
        deny: ['denied'],
        env: { TEST_KEY: 'ok' },
        hasBinary: (bin) => bin === 'bin1',
      });

      expect(filtered).toHaveLength(1);
      expect(filtered[0]?.name).toBe('allowed');
    });

    it('should exclude skills with missing env requirements', () => {
      const skills = [
        {
          name: 'needs-env',
          metadata: {
            name: 'needs-env',
            description: 'Needs env',
            nachos: { requires: { env: ['MISSING_ENV'] } },
          },
          content: '# Needs env',
          filePath: '/test/needs-env/SKILL.md',
        },
      ];

      const filtered = filterSkillsForPrompt(skills, {
        env: {},
      });

      expect(filtered).toHaveLength(0);
    });
  });
});
