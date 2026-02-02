/**
 * Policy Loader
 *
 * Loads policy documents from YAML files with hot-reload support.
 */

import { readFileSync, readdirSync, existsSync, watch } from 'node:fs'
import { join, extname } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { PolicyDocument, PolicyValidationError } from '../types/index.js'
import { validatePolicyDocument } from './validator.js'

/**
 * Policy loader configuration
 */
export interface PolicyLoaderConfig {
  /** Directory containing policy YAML files */
  policiesPath: string
  /** Enable file watching for hot-reload */
  enableHotReload: boolean
  /** Callback when policies are reloaded */
  onReload?: (policies: PolicyDocument[], errors: PolicyValidationError[]) => void
  /** Callback on reload error */
  onError?: (error: Error) => void
}

/**
 * Policy Loader
 *
 * Loads policy documents from YAML files in a directory.
 * Supports hot-reload via file watching.
 */
export class PolicyLoader {
  private config: PolicyLoaderConfig
  private policies: PolicyDocument[] = []
  private watcher: ReturnType<typeof watch> | null = null
  private reloadTimeoutId: NodeJS.Timeout | null = null

  constructor(config: PolicyLoaderConfig) {
    this.config = config
  }

  /**
   * Load all policy files from the configured directory
   * @returns Tuple of [policies, validation errors]
   */
  load(): [PolicyDocument[], PolicyValidationError[]] {
    const errors: PolicyValidationError[] = []
    const policies: PolicyDocument[] = []

    // Check if directory exists
    if (!existsSync(this.config.policiesPath)) {
      errors.push({
        file: this.config.policiesPath,
        message: `Policy directory does not exist: ${this.config.policiesPath}`,
      })
      return [policies, errors]
    }

    // Read all YAML files in directory
    const files = readdirSync(this.config.policiesPath)
    const yamlFiles = files.filter(
      (f) => extname(f) === '.yaml' || extname(f) === '.yml'
    )

    if (yamlFiles.length === 0) {
      console.warn(`[PolicyLoader] No policy files found in ${this.config.policiesPath}`)
    }

    // Load and validate each file
    for (const filename of yamlFiles) {
      const filepath = join(this.config.policiesPath, filename)
      try {
        const content = readFileSync(filepath, 'utf-8')
        const doc = parseYaml(content)

        // Validate the policy document
        const validationErrors = validatePolicyDocument(doc, filename)
        if (validationErrors.length > 0) {
          errors.push(...validationErrors)
          continue
        }

        policies.push(doc as PolicyDocument)
      } catch (error) {
        errors.push({
          file: filename,
          message: `Failed to load policy file: ${error instanceof Error ? error.message : String(error)}`,
        })
      }
    }

    this.policies = policies
    return [policies, errors]
  }

  /**
   * Get currently loaded policies
   */
  getPolicies(): PolicyDocument[] {
    return this.policies
  }

  /**
   * Start watching policy files for changes
   */
  startWatching(): void {
    if (!this.config.enableHotReload) {
      return
    }

    if (this.watcher) {
      console.warn('[PolicyLoader] Watcher already started')
      return
    }

    if (!existsSync(this.config.policiesPath)) {
      console.error(`[PolicyLoader] Cannot watch non-existent directory: ${this.config.policiesPath}`)
      return
    }

    console.log(`[PolicyLoader] Watching ${this.config.policiesPath} for policy changes`)

    this.watcher = watch(
      this.config.policiesPath,
      { recursive: false },
      (eventType, filename) => {
        if (!filename) return

        // Only reload on YAML file changes
        const ext = extname(filename)
        if (ext !== '.yaml' && ext !== '.yml') return

        console.log(`[PolicyLoader] Policy file changed: ${filename} (${eventType})`)

        // Debounce reloads to handle multiple rapid changes
        if (this.reloadTimeoutId) {
          clearTimeout(this.reloadTimeoutId)
        }

        this.reloadTimeoutId = setTimeout(() => {
          this.reload()
        }, 100) // 100ms debounce
      }
    )
  }

  /**
   * Stop watching policy files
   */
  stopWatching(): void {
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
      console.log('[PolicyLoader] Stopped watching policy files')
    }

    if (this.reloadTimeoutId) {
      clearTimeout(this.reloadTimeoutId)
      this.reloadTimeoutId = null
    }
  }

  /**
   * Reload all policies from disk
   */
  reload(): void {
    try {
      console.log('[PolicyLoader] Reloading policies...')
      const [policies, errors] = this.load()

      if (errors.length > 0) {
        console.error('[PolicyLoader] Validation errors during reload:')
        for (const error of errors) {
          console.error(`  - ${error.file}: ${error.message}`)
        }
      }

      console.log(`[PolicyLoader] Loaded ${policies.length} policy document(s)`)

      // Notify callback
      if (this.config.onReload) {
        this.config.onReload(policies, errors)
      }
    } catch (error) {
      console.error('[PolicyLoader] Error during reload:', error)
      if (this.config.onError) {
        this.config.onError(error as Error)
      }
    }
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.stopWatching()
    this.policies = []
  }
}

/**
 * Create a policy loader with default configuration
 */
export function createPolicyLoader(
  policiesPath: string,
  enableHotReload = true
): PolicyLoader {
  return new PolicyLoader({
    policiesPath,
    enableHotReload,
  })
}
