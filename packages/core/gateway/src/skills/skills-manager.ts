/**
 * SkillsManager — owns skill loading, filtering, hot-reload, and prompt generation.
 * Extracted from Gateway to reduce the monolithic class.
 */
import { createLogger } from '@nachos/types';
import { TOPICS } from '@nachos/bus';
import type { NachosConfig, SkillsConfig, ToolsConfig } from '@nachos/config';
import type { Skill } from './skill-loader.js';
import type { SkillWatcher } from './skill-watcher.js';
import type { SkillToolConfig } from '../tools/shell-tool.js';
import type { NatsBusAdapter } from '../router.js';
import { createEnvelope } from '../router.js';

const logger = createLogger('skills-manager');

export interface SkillsManagerDeps {
  /** Resolve tool group name for a given binary */
  resolveToolGroup(bin: string): string | undefined;
  /** Get the NATS bus for publishing events */
  getBus(): NatsBusAdapter | null;
}

export interface SkillsManagerConfig {
  skillsConfig?: SkillsConfig;
  nachosConfig?: NachosConfig;
  toolsConfig?: ToolsConfig;
}

export class SkillsManager {
  private skillsPrompt: string | null = null;
  private skillsDir: string | null = null;
  private currentSkills: Skill[] = [];
  private skillWatcher: SkillWatcher | null = null;
  private deps: SkillsManagerDeps;
  private config: SkillsManagerConfig;

  constructor(deps: SkillsManagerDeps, config: SkillsManagerConfig) {
    this.deps = deps;
    this.config = config;
  }

  getSkillsPrompt(): string | null {
    return this.skillsPrompt;
  }

  getCurrentSkills(): Skill[] {
    return this.currentSkills;
  }

  getSkillsDir(): string | null {
    return this.skillsDir;
  }

  /**
   * Initialize skills: load from disk, build prompt, optionally start watcher.
   * Returns the SkillToolConfig[] needed by LocalToolHandler.
   */
  async init(): Promise<SkillToolConfig[]> {
    let skillToolConfigs: SkillToolConfig[] = [];

    try {
      const { formatSkillsForPrompt } = await import('./skill-loader.js');
      const { join } = await import('path');
      const { fileURLToPath } = await import('url');
      const { dirname } = await import('path');

      // Resolve skills directory (relative to gateway package)
      const currentDir = dirname(fileURLToPath(import.meta.url));
      const skillsDir = join(currentDir, '..', '..', '..', '..', 'skills');
      this.skillsDir = skillsDir;

      // Initial skill load
      const skillsForPrompt = await this.loadAndFilterSkills();
      this.currentSkills = skillsForPrompt;

      if (skillsForPrompt.length > 0) {
        this.skillsPrompt = formatSkillsForPrompt(skillsForPrompt);
        logger.info({ count: skillsForPrompt.length }, 'Loaded skills for LLM prompt');
      } else {
        logger.warn('No skills loaded');
      }

      skillToolConfigs = this.buildSkillToolConfigs(skillsForPrompt);

      // Start skill watcher if hot reload is enabled
      const hotReloadEnabled =
        this.config.skillsConfig?.hot_reload ?? process.env.NODE_ENV !== 'production';
      if (hotReloadEnabled) {
        const { SkillWatcher: WatcherCtor } = await import('./skill-watcher.js');
        this.skillWatcher = new WatcherCtor({
          skillsDir,
          debounceMs: this.config.skillsConfig?.debounce_ms ?? 500,
          onReload: async () => this.handleSkillReload(),
        });
        this.skillWatcher.start();
        logger.info('Skill hot reload enabled');
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to load skills');
    }

    return skillToolConfigs;
  }

  /**
   * Stop the skill watcher if running.
   */
  stop(): void {
    if (this.skillWatcher) {
      this.skillWatcher.stop();
      this.skillWatcher = null;
    }
  }

  /**
   * Load and filter skills for the system prompt.
   */
  async loadAndFilterSkills(): Promise<Skill[]> {
    if (!this.skillsDir) {
      return [];
    }

    const { loadSkills, filterSkillsForPrompt } = await import('./skill-loader.js');
    const skills = loadSkills({ skillsDir: this.skillsDir });
    const shellEnabled = this.config.toolsConfig?.shell?.enabled !== false;
    const allowlist = this.config.skillsConfig?.allow ?? this.config.skillsConfig?.enabled;
    const filtered = filterSkillsForPrompt(skills, {
      allow: allowlist,
      deny: this.config.skillsConfig?.deny,
      entries: this.config.skillsConfig?.entries,
      config: this.config.nachosConfig,
    });

    return shellEnabled ? filtered : [];
  }

  /**
   * Handle skill reload from watcher.
   */
  async handleSkillReload(): Promise<{ previous: Skill[]; current: Skill[] }> {
    const previous = this.currentSkills;
    const current = await this.loadAndFilterSkills();

    // Update skills prompt
    const { formatSkillsForPrompt } = await import('./skill-loader.js');
    this.skillsPrompt = current.length > 0 ? formatSkillsForPrompt(current) : null;
    this.currentSkills = current;

    // Detect changes
    const prevMap = new Map(previous.map((s) => [s.name, s]));
    const currMap = new Map(current.map((s) => [s.name, s]));

    const added: string[] = [];
    const removed: string[] = [];
    const modified: string[] = [];

    for (const [name, skill] of currMap) {
      const prevSkill = prevMap.get(name);
      if (!prevSkill) {
        added.push(name);
      } else if (prevSkill.content !== skill.content) {
        modified.push(name);
      }
    }

    for (const name of prevMap.keys()) {
      if (!currMap.has(name)) {
        removed.push(name);
      }
    }

    logger.info({ added, removed, modified, total: current.length }, 'Skills reloaded');

    // Publish NATS event
    try {
      const bus = this.deps.getBus();
      if (bus) {
        await bus.publish(
          TOPICS.skills.reloaded,
          createEnvelope('gateway', 'skills.reloaded', {
            event: 'skills.reloaded',
            added,
            removed,
            modified,
            total: current.length,
            timestamp: Date.now(),
          })
        );
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to publish skills.reloaded event');
    }

    return { previous, current };
  }

  /**
   * Build SkillToolConfig[] from loaded skills, used by LocalToolHandler / ShellTool.
   */
  buildSkillToolConfigs(skills: Skill[]): SkillToolConfig[] {
    const configs = new Map<string, SkillToolConfig>();

    for (const skill of skills) {
      const bins = skill.metadata.nachos?.requires?.bins ?? [];
      const requiredEnv = skill.metadata.nachos?.requires?.env ?? [];
      for (const bin of bins) {
        if (configs.has(bin)) {
          continue;
        }
        const group = this.deps.resolveToolGroup(bin) ?? 'shell';
        configs.set(bin, {
          bin,
          group,
          requiredEnv,
        });
      }
    }

    return Array.from(configs.values());
  }
}
