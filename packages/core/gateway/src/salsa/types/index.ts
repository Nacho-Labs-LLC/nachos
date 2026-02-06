/**
 * Salsa Policy Engine Types
 *
 * Type definitions for the embedded policy engine that controls
 * all security decisions in the Gateway.
 */

/**
 * Security mode affects which policies are active
 */
export type SecurityMode = 'strict' | 'standard' | 'permissive';

/**
 * Policy effect determines the outcome of a rule match
 */
export type PolicyEffect = 'allow' | 'deny';

/**
 * Policy priority determines evaluation order
 * Higher priority rules are evaluated first
 */
export type PolicyPriority = number;

/**
 * Resource type being accessed
 */
export type ResourceType = 'tool' | 'channel' | 'dm' | 'filesystem' | 'network' | 'llm';

/**
 * Action being performed
 */
export type ActionType = 'read' | 'write' | 'execute' | 'send' | 'receive' | 'call';

/**
 * Policy condition operators
 */
export type ConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'in'
  | 'not_in'
  | 'contains'
  | 'matches'
  | 'starts_with'
  | 'ends_with';

/**
 * A single condition in a policy rule
 */
export interface PolicyCondition {
  /** Field to check (e.g., "security_mode", "user_id", "path") */
  field: string;
  /** Comparison operator */
  operator: ConditionOperator;
  /** Value(s) to compare against */
  value: string | string[] | number | boolean;
}

/**
 * Match criteria for a policy rule
 */
export interface PolicyMatch {
  /** Resource type (optional - if not specified, matches all) */
  resource?: ResourceType | ResourceType[];
  /** Action type (optional - if not specified, matches all) */
  action?: ActionType | ActionType[];
  /** Specific resource identifier (e.g., tool name, channel ID) */
  resourceId?: string | string[];
}

/**
 * A single policy rule
 */
export interface PolicyRule {
  /** Unique rule identifier */
  id: string;
  /** Human-readable description */
  description?: string;
  /** Priority (higher = evaluated first) */
  priority: PolicyPriority;
  /** Match criteria */
  match: PolicyMatch;
  /** Additional conditions that must be satisfied */
  conditions?: PolicyCondition[];
  /** Effect when rule matches */
  effect: PolicyEffect;
  /** Optional reason message for deny */
  reason?: string;
}

/**
 * A policy document containing multiple rules
 */
export interface PolicyDocument {
  /** Policy version for schema evolution */
  version: string;
  /** Policy metadata */
  metadata?: {
    name?: string;
    description?: string;
    mode?: SecurityMode;
  };
  /** List of policy rules */
  rules: PolicyRule[];
}

/**
 * Security request to evaluate against policies
 */
export interface SecurityRequest {
  /** Unique request ID for audit trail */
  requestId: string;
  /** User making the request */
  userId: string;
  /** Session ID */
  sessionId: string;
  /** Current security mode */
  securityMode: SecurityMode;
  /** Resource being accessed */
  resource: {
    type: ResourceType;
    id: string;
  };
  /** Action being performed */
  action: ActionType;
  /** Request metadata for condition evaluation */
  metadata: Record<string, any>;
  /** Timestamp */
  timestamp: Date;
}

/**
 * Result of policy evaluation
 */
export interface SecurityResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Effect that was applied */
  effect: PolicyEffect;
  /** Rule ID that matched (if any) */
  ruleId?: string;
  /** Reason for denial (if denied) */
  reason?: string;
  /** Evaluation time in milliseconds */
  evaluationTimeMs: number;
}

/**
 * Policy engine configuration
 */
export interface PolicyEngineConfig {
  /** Path to policy files directory */
  policiesPath: string;
  /** Current security mode */
  securityMode: SecurityMode;
  /** Enable hot-reload of policies */
  enableHotReload: boolean;
  /** Default effect when no rule matches */
  defaultEffect: PolicyEffect;
}

/**
 * Policy validation error
 */
export interface PolicyValidationError {
  /** File that failed validation */
  file: string;
  /** Rule ID with error (if applicable) */
  ruleId?: string;
  /** Error message */
  message: string;
  /** Field that caused error */
  field?: string;
}

/**
 * Policy engine statistics
 */
export interface PolicyEngineStats {
  /** Number of policies loaded */
  policiesLoaded: number;
  /** Number of rules active */
  rulesActive: number;
  /** Total evaluations performed */
  evaluationsTotal: number;
  /** Average evaluation time in ms */
  avgEvaluationTimeMs: number;
  /** Last policy reload timestamp */
  lastReload?: Date;
}
