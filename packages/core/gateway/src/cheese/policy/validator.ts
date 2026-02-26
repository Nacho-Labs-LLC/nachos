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
export function validatePolicyDocument(doc: unknown, filename: string): PolicyValidationError[] {
  const errors: PolicyValidationError[] = [];

  if (!doc || typeof doc !== 'object') {
    errors.push({
      file: filename,
      message: 'Policy document must be an object',
    });
    return errors;
  }

  const policyDoc = doc as { version?: unknown; rules?: unknown[] };

  // Check required fields
  if (!policyDoc.version) {
    errors.push({
      file: filename,
      message: 'Missing required field: version',
      field: 'version',
    });
  }

  if (!policyDoc.rules || !Array.isArray(policyDoc.rules)) {
    errors.push({
      file: filename,
      message: 'Missing or invalid rules array',
      field: 'rules',
    });
    return errors; // Can't continue without rules array
  }

  // Validate each rule
  const ruleIds = new Set<string>();
  for (let i = 0; i < policyDoc.rules.length; i++) {
    const rule = policyDoc.rules[i];
    const ruleErrors = validatePolicyRule(rule, filename, i);
    errors.push(...ruleErrors);

    // Check for duplicate rule IDs
    const ruleIdValue = (rule as { id?: unknown }).id;
    const ruleId = typeof ruleIdValue === 'string' ? ruleIdValue : undefined;
    if (ruleId) {
      if (ruleIds.has(ruleId)) {
        errors.push({
          file: filename,
          ruleId,
          message: `Duplicate rule ID: ${ruleId}`,
          field: 'id',
        });
      }
      ruleIds.add(ruleId);
    }
  }

  return errors;
}

/**
 * Validate a single policy rule
 */
function validatePolicyRule(
  rule: unknown,
  filename: string,
  index: number
): PolicyValidationError[] {
  const errors: PolicyValidationError[] = [];
  const ruleObject: Record<string, unknown> =
    typeof rule === 'object' && rule !== null ? (rule as Record<string, unknown>) : {};
  const ruleId = typeof ruleObject.id === 'string' ? ruleObject.id : `rule-${index}`;

  // Required fields
  if (!ruleObject.id || typeof ruleObject.id !== 'string') {
    errors.push({
      file: filename,
      ruleId,
      message: 'Rule must have a string id',
      field: 'id',
    });
  }

  if (typeof ruleObject.priority !== 'number') {
    errors.push({
      file: filename,
      ruleId,
      message: 'Rule must have a numeric priority',
      field: 'priority',
    });
  }

  if (!ruleObject.match || typeof ruleObject.match !== 'object') {
    errors.push({
      file: filename,
      ruleId,
      message: 'Rule must have a match object',
      field: 'match',
    });
  } else {
    errors.push(...validatePolicyMatch(ruleObject.match, filename, ruleId));
  }

  if (!ruleObject.effect || !VALID_EFFECTS.includes(ruleObject.effect as PolicyEffect)) {
    errors.push({
      file: filename,
      ruleId,
      message: `Rule must have a valid effect (${VALID_EFFECTS.join(', ')})`,
      field: 'effect',
    });
  }

  // Optional fields
  if (ruleObject.conditions) {
    if (!Array.isArray(ruleObject.conditions)) {
      errors.push({
        file: filename,
        ruleId,
        message: 'Conditions must be an array',
        field: 'conditions',
      });
    } else {
      for (let i = 0; i < ruleObject.conditions.length; i++) {
        errors.push(...validatePolicyCondition(ruleObject.conditions[i], filename, ruleId, i));
      }
    }
  }

  return errors;
}

/**
 * Validate policy match criteria
 */
function validatePolicyMatch(
  match: unknown,
  filename: string,
  ruleId: string
): PolicyValidationError[] {
  const errors: PolicyValidationError[] = [];
  const matchObject =
    typeof match === 'object' && match !== null ? (match as Record<string, unknown>) : {};

  if (matchObject.resource) {
    const resources = Array.isArray(matchObject.resource)
      ? matchObject.resource
      : [matchObject.resource];
    for (const resource of resources) {
      if (
        typeof resource !== 'string' ||
        !VALID_RESOURCE_TYPES.includes(resource as ResourceType)
      ) {
        errors.push({
          file: filename,
          ruleId,
          message: `Invalid resource type: ${resource}. Must be one of: ${VALID_RESOURCE_TYPES.join(', ')}`,
          field: 'match.resource',
        });
      }
    }
  }

  if (matchObject.action) {
    const actions = Array.isArray(matchObject.action) ? matchObject.action : [matchObject.action];
    for (const action of actions) {
      if (typeof action !== 'string' || !VALID_ACTION_TYPES.includes(action as ActionType)) {
        errors.push({
          file: filename,
          ruleId,
          message: `Invalid action type: ${action}. Must be one of: ${VALID_ACTION_TYPES.join(', ')}`,
          field: 'match.action',
        });
      }
    }
  }

  if (matchObject.resourceId !== undefined) {
    if (
      typeof matchObject.resourceId !== 'string' &&
      !(
        Array.isArray(matchObject.resourceId) &&
        matchObject.resourceId.every((id) => typeof id === 'string')
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
  condition: unknown,
  filename: string,
  ruleId: string,
  index: number
): PolicyValidationError[] {
  const errors: PolicyValidationError[] = [];
  const conditionObject =
    typeof condition === 'object' && condition !== null
      ? (condition as Record<string, unknown>)
      : {};

  if (!conditionObject.field || typeof conditionObject.field !== 'string') {
    errors.push({
      file: filename,
      ruleId,
      message: `Condition ${index} must have a string field`,
      field: `conditions[${index}].field`,
    });
  }

  if (
    !conditionObject.operator ||
    !VALID_OPERATORS.includes(conditionObject.operator as ConditionOperator)
  ) {
    errors.push({
      file: filename,
      ruleId,
      message: `Condition ${index} must have a valid operator (${VALID_OPERATORS.join(', ')})`,
      field: `conditions[${index}].operator`,
    });
  }

  if (conditionObject.value === undefined) {
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
export function isPolicyDocumentValid(doc: unknown, filename: string): boolean {
  const errors = validatePolicyDocument(doc, filename);
  return errors.length === 0;
}
