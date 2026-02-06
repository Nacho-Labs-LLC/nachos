/**
 * Policy Validation
 *
 * Validates policy documents against the schema to catch
 * configuration errors early.
 */

import type {
  PolicyValidationError,
  ResourceType,
  ActionType,
  ConditionOperator,
  PolicyEffect,
} from '../types/index.js';

const VALID_RESOURCE_TYPES: ResourceType[] = [
  'tool',
  'channel',
  'dm',
  'filesystem',
  'network',
  'llm',
];
const VALID_ACTION_TYPES: ActionType[] = ['read', 'write', 'execute', 'send', 'receive', 'call'];
const VALID_OPERATORS: ConditionOperator[] = [
  'equals',
  'not_equals',
  'in',
  'not_in',
  'contains',
  'matches',
  'starts_with',
  'ends_with',
];
const VALID_EFFECTS: PolicyEffect[] = ['allow', 'deny'];

/**
 * Validate a policy document
 * @param doc - Policy document to validate
 * @param filename - Filename for error messages
 * @returns Array of validation errors (empty if valid)
 */
export function validatePolicyDocument(doc: any, filename: string): PolicyValidationError[] {
  const errors: PolicyValidationError[] = [];

  // Check required fields
  if (!doc.version) {
    errors.push({
      file: filename,
      message: 'Missing required field: version',
      field: 'version',
    });
  }

  if (!doc.rules || !Array.isArray(doc.rules)) {
    errors.push({
      file: filename,
      message: 'Missing or invalid rules array',
      field: 'rules',
    });
    return errors; // Can't continue without rules array
  }

  // Validate each rule
  const ruleIds = new Set<string>();
  for (let i = 0; i < doc.rules.length; i++) {
    const rule = doc.rules[i];
    const ruleErrors = validatePolicyRule(rule, filename, i);
    errors.push(...ruleErrors);

    // Check for duplicate rule IDs
    if (rule.id) {
      if (ruleIds.has(rule.id)) {
        errors.push({
          file: filename,
          ruleId: rule.id,
          message: `Duplicate rule ID: ${rule.id}`,
          field: 'id',
        });
      }
      ruleIds.add(rule.id);
    }
  }

  return errors;
}

/**
 * Validate a single policy rule
 */
function validatePolicyRule(rule: any, filename: string, index: number): PolicyValidationError[] {
  const errors: PolicyValidationError[] = [];
  const ruleId = rule.id || `rule-${index}`;

  // Required fields
  if (!rule.id || typeof rule.id !== 'string') {
    errors.push({
      file: filename,
      ruleId,
      message: 'Rule must have a string id',
      field: 'id',
    });
  }

  if (typeof rule.priority !== 'number') {
    errors.push({
      file: filename,
      ruleId,
      message: 'Rule must have a numeric priority',
      field: 'priority',
    });
  }

  if (!rule.match || typeof rule.match !== 'object') {
    errors.push({
      file: filename,
      ruleId,
      message: 'Rule must have a match object',
      field: 'match',
    });
  } else {
    errors.push(...validatePolicyMatch(rule.match, filename, ruleId));
  }

  if (!rule.effect || !VALID_EFFECTS.includes(rule.effect)) {
    errors.push({
      file: filename,
      ruleId,
      message: `Rule must have a valid effect (${VALID_EFFECTS.join(', ')})`,
      field: 'effect',
    });
  }

  // Optional fields
  if (rule.conditions) {
    if (!Array.isArray(rule.conditions)) {
      errors.push({
        file: filename,
        ruleId,
        message: 'Conditions must be an array',
        field: 'conditions',
      });
    } else {
      for (let i = 0; i < rule.conditions.length; i++) {
        errors.push(...validatePolicyCondition(rule.conditions[i], filename, ruleId, i));
      }
    }
  }

  return errors;
}

/**
 * Validate policy match criteria
 */
function validatePolicyMatch(
  match: any,
  filename: string,
  ruleId: string
): PolicyValidationError[] {
  const errors: PolicyValidationError[] = [];

  if (match.resource) {
    const resources = Array.isArray(match.resource) ? match.resource : [match.resource];
    for (const resource of resources) {
      if (!VALID_RESOURCE_TYPES.includes(resource)) {
        errors.push({
          file: filename,
          ruleId,
          message: `Invalid resource type: ${resource}. Must be one of: ${VALID_RESOURCE_TYPES.join(', ')}`,
          field: 'match.resource',
        });
      }
    }
  }

  if (match.action) {
    const actions = Array.isArray(match.action) ? match.action : [match.action];
    for (const action of actions) {
      if (!VALID_ACTION_TYPES.includes(action)) {
        errors.push({
          file: filename,
          ruleId,
          message: `Invalid action type: ${action}. Must be one of: ${VALID_ACTION_TYPES.join(', ')}`,
          field: 'match.action',
        });
      }
    }
  }

  if (match.resourceId !== undefined) {
    if (
      typeof match.resourceId !== 'string' &&
      !(
        Array.isArray(match.resourceId) &&
        match.resourceId.every((id: any) => typeof id === 'string')
      )
    ) {
      errors.push({
        file: filename,
        ruleId,
        message: 'resourceId must be a string or array of strings',
        field: 'match.resourceId',
      });
    }
  }

  return errors;
}

/**
 * Validate a policy condition
 */
function validatePolicyCondition(
  condition: any,
  filename: string,
  ruleId: string,
  index: number
): PolicyValidationError[] {
  const errors: PolicyValidationError[] = [];

  if (!condition.field || typeof condition.field !== 'string') {
    errors.push({
      file: filename,
      ruleId,
      message: `Condition ${index} must have a string field`,
      field: `conditions[${index}].field`,
    });
  }

  if (!condition.operator || !VALID_OPERATORS.includes(condition.operator)) {
    errors.push({
      file: filename,
      ruleId,
      message: `Condition ${index} must have a valid operator (${VALID_OPERATORS.join(', ')})`,
      field: `conditions[${index}].operator`,
    });
  }

  if (condition.value === undefined) {
    errors.push({
      file: filename,
      ruleId,
      message: `Condition ${index} must have a value`,
      field: `conditions[${index}].value`,
    });
  }

  return errors;
}

/**
 * Check if a policy document is valid
 */
export function isPolicyDocumentValid(doc: any, filename: string): boolean {
  const errors = validatePolicyDocument(doc, filename);
  return errors.length === 0;
}
