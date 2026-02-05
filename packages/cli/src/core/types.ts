/**
 * Shared TypeScript types for Nachos CLI
 */

/**
 * Standard JSON output envelope for all CLI commands
 */
export interface CommandOutput<T = unknown> {
  /** Success flag */
  ok: boolean;
  /** Command name (e.g., "up", "status", "doctor") */
  command: string;
  /** Command-specific data (only present if ok=true) */
  data?: T;
  /** Error information (only present if ok=false) */
  error?: {
    /** Machine-readable error code */
    code: string;
    /** Human-readable error message */
    message: string;
    /** Additional error context */
    details?: unknown;
  };
  /** Metadata about the command execution */
  meta: {
    /** ISO 8601 timestamp */
    timestamp: string;
    /** CLI version */
    version: string;
    /** Path to nachos.toml file used (if applicable) */
    config_path?: string;
    /** Command execution duration in milliseconds */
    duration_ms?: number;
  };
}

/**
 * Docker container status
 */
export interface ContainerStatus {
  ID: string;
  Name: string;
  Service: string;
  State: string;
  Status: string;
  Health: string;
  ExitCode: number;
  Publishers?: Array<{
    URL: string;
    TargetPort: number;
    PublishedPort: number;
    Protocol: string;
  }>;
}

/**
 * Doctor check result
 */
export interface DoctorCheck {
  /** Unique check identifier */
  id: string;
  /** Human-readable check name */
  name: string;
  /** Check status */
  status: 'pass' | 'warn' | 'fail';
  /** Check result message */
  message: string;
  /** Optional suggestion for failed/warned checks */
  suggestion?: string;
}

/**
 * Module list item
 */
export interface ModuleListItem {
  /** Module name */
  name: string;
  /** Module type */
  type: 'channel' | 'tool' | 'skill';
  /** Whether module is enabled */
  enabled: boolean;
  /** Whether module is configured (has config section) */
  configured: boolean;
}

/**
 * Stack status information
 */
export interface StackStatus {
  /** Whether the stack is running */
  running: boolean;
  /** Container statuses */
  containers: ContainerStatus[];
  /** Service URLs */
  urls: {
    gateway?: string;
    webchat?: string;
    nats_monitoring?: string;
  };
}

/**
 * Init command options
 */
export interface InitOptions {
  /** Project name */
  name: string;
  /** LLM provider */
  provider: 'anthropic' | 'openai' | 'ollama';
  /** Security mode */
  securityMode: 'strict' | 'standard' | 'permissive';
  /** Enable webchat */
  enableWebchat: boolean;
}
