/**
 * Tests for Nachos Error Types and Factories
 */

import { describe, it, expect } from 'vitest';
import {
  NachosError,
  NachosErrorCodes,
  createConfigError,
  createPolicyDeniedError,
  createRateLimitedError,
  createLLMFailedError,
  createToolFailedError,
  createChannelFailedError,
  createSessionNotFoundError,
  createTimeoutError,
  createInternalError,
  createValidationError,
  createBusConnectionError,
  createInvalidMessageError,
  createAuthFailedError,
  createPermissionDeniedError,
  createNotFoundError,
  createAlreadyExistsError,
  createInvalidStateError,
  isNachosError,
  hasErrorCode,
  wrapError,
  extractErrorInfo,
} from './errors.js';

describe('NachosErrorCodes', () => {
  it('should have all error codes defined', () => {
    expect(NachosErrorCodes.CONFIG).toBe('NACHOS_ERR_CONFIG');
    expect(NachosErrorCodes.POLICY_DENIED).toBe('NACHOS_ERR_POLICY_DENIED');
    expect(NachosErrorCodes.RATE_LIMITED).toBe('NACHOS_ERR_RATE_LIMITED');
    expect(NachosErrorCodes.LLM_FAILED).toBe('NACHOS_ERR_LLM_FAILED');
    expect(NachosErrorCodes.TOOL_FAILED).toBe('NACHOS_ERR_TOOL_FAILED');
    expect(NachosErrorCodes.CHANNEL_FAILED).toBe('NACHOS_ERR_CHANNEL_FAILED');
    expect(NachosErrorCodes.SESSION_NOT_FOUND).toBe('NACHOS_ERR_SESSION_NOT_FOUND');
    expect(NachosErrorCodes.TIMEOUT).toBe('NACHOS_ERR_TIMEOUT');
    expect(NachosErrorCodes.INTERNAL).toBe('NACHOS_ERR_INTERNAL');
    expect(NachosErrorCodes.VALIDATION).toBe('NACHOS_ERR_VALIDATION');
    expect(NachosErrorCodes.BUS_CONNECTION).toBe('NACHOS_ERR_BUS_CONNECTION');
    expect(NachosErrorCodes.INVALID_MESSAGE).toBe('NACHOS_ERR_INVALID_MESSAGE');
    expect(NachosErrorCodes.AUTH_FAILED).toBe('NACHOS_ERR_AUTH_FAILED');
    expect(NachosErrorCodes.PERMISSION_DENIED).toBe('NACHOS_ERR_PERMISSION_DENIED');
    expect(NachosErrorCodes.NOT_FOUND).toBe('NACHOS_ERR_NOT_FOUND');
    expect(NachosErrorCodes.ALREADY_EXISTS).toBe('NACHOS_ERR_ALREADY_EXISTS');
    expect(NachosErrorCodes.INVALID_STATE).toBe('NACHOS_ERR_INVALID_STATE');
  });
});

describe('NachosError', () => {
  it('should create error with all properties', () => {
    const error = new NachosError({
      code: NachosErrorCodes.VALIDATION,
      message: 'Invalid input',
      component: 'gateway',
      details: { field: 'email' },
      timestamp: '2024-01-15T10:30:00.000Z',
      correlationId: 'corr-123',
    });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(NachosError);
    expect(error.name).toBe('NachosError');
    expect(error.code).toBe('NACHOS_ERR_VALIDATION');
    expect(error.message).toBe('Invalid input');
    expect(error.component).toBe('gateway');
    expect(error.details).toEqual({ field: 'email' });
    expect(error.timestamp).toBe('2024-01-15T10:30:00.000Z');
    expect(error.correlationId).toBe('corr-123');
  });

  it('should preserve cause when provided', () => {
    const cause = new Error('Original error');
    const error = new NachosError({
      code: NachosErrorCodes.INTERNAL,
      message: 'Wrapped error',
      component: 'bus',
      timestamp: '2024-01-15T10:30:00.000Z',
      cause,
    });

    expect(error.cause).toBe(cause);
  });

  it('should convert to JSON correctly', () => {
    const error = new NachosError({
      code: NachosErrorCodes.TIMEOUT,
      message: 'Request timed out',
      component: 'llm-proxy',
      details: { timeout: 5000 },
      timestamp: '2024-01-15T10:30:00.000Z',
      correlationId: 'corr-456',
    });

    const json = error.toJSON();

    expect(json).toEqual({
      code: 'NACHOS_ERR_TIMEOUT',
      message: 'Request timed out',
      component: 'llm-proxy',
      details: { timeout: 5000 },
      timestamp: '2024-01-15T10:30:00.000Z',
      correlationId: 'corr-456',
    });
  });

  it('should convert to string correctly', () => {
    const error = new NachosError({
      code: NachosErrorCodes.CONFIG,
      message: 'Missing configuration',
      component: 'gateway',
      timestamp: '2024-01-15T10:30:00.000Z',
    });

    const str = error.toString();
    expect(str).toBe('[NACHOS_ERR_CONFIG] Missing configuration (component: gateway)');
  });
});

describe('Error Factory Functions', () => {
  const baseOptions = {
    component: 'test-component',
    details: { key: 'value' },
    correlationId: 'test-corr-id',
  };

  describe('createConfigError', () => {
    it('should create config error', () => {
      const error = createConfigError('Invalid config', baseOptions);
      expect(error.code).toBe(NachosErrorCodes.CONFIG);
      expect(error.message).toBe('Invalid config');
      expect(error.component).toBe('test-component');
    });
  });

  describe('createPolicyDeniedError', () => {
    it('should create policy denied error', () => {
      const error = createPolicyDeniedError('Action not allowed', baseOptions);
      expect(error.code).toBe(NachosErrorCodes.POLICY_DENIED);
    });
  });

  describe('createRateLimitedError', () => {
    it('should create rate limited error', () => {
      const error = createRateLimitedError('Too many requests', baseOptions);
      expect(error.code).toBe(NachosErrorCodes.RATE_LIMITED);
    });
  });

  describe('createLLMFailedError', () => {
    it('should create LLM failed error', () => {
      const error = createLLMFailedError('LLM request failed', baseOptions);
      expect(error.code).toBe(NachosErrorCodes.LLM_FAILED);
    });
  });

  describe('createToolFailedError', () => {
    it('should create tool failed error', () => {
      const error = createToolFailedError('Tool execution failed', baseOptions);
      expect(error.code).toBe(NachosErrorCodes.TOOL_FAILED);
    });
  });

  describe('createChannelFailedError', () => {
    it('should create channel failed error', () => {
      const error = createChannelFailedError('Channel disconnected', baseOptions);
      expect(error.code).toBe(NachosErrorCodes.CHANNEL_FAILED);
    });
  });

  describe('createSessionNotFoundError', () => {
    it('should create session not found error', () => {
      const error = createSessionNotFoundError('Session not found', baseOptions);
      expect(error.code).toBe(NachosErrorCodes.SESSION_NOT_FOUND);
    });
  });

  describe('createTimeoutError', () => {
    it('should create timeout error', () => {
      const error = createTimeoutError('Operation timed out', baseOptions);
      expect(error.code).toBe(NachosErrorCodes.TIMEOUT);
    });
  });

  describe('createInternalError', () => {
    it('should create internal error', () => {
      const error = createInternalError('Unexpected error', baseOptions);
      expect(error.code).toBe(NachosErrorCodes.INTERNAL);
    });
  });

  describe('createValidationError', () => {
    it('should create validation error', () => {
      const error = createValidationError('Invalid input', baseOptions);
      expect(error.code).toBe(NachosErrorCodes.VALIDATION);
    });
  });

  describe('createBusConnectionError', () => {
    it('should create bus connection error', () => {
      const error = createBusConnectionError('Connection failed', baseOptions);
      expect(error.code).toBe(NachosErrorCodes.BUS_CONNECTION);
    });
  });

  describe('createInvalidMessageError', () => {
    it('should create invalid message error', () => {
      const error = createInvalidMessageError('Invalid message format', baseOptions);
      expect(error.code).toBe(NachosErrorCodes.INVALID_MESSAGE);
    });
  });

  describe('createAuthFailedError', () => {
    it('should create auth failed error', () => {
      const error = createAuthFailedError('Authentication failed', baseOptions);
      expect(error.code).toBe(NachosErrorCodes.AUTH_FAILED);
    });
  });

  describe('createPermissionDeniedError', () => {
    it('should create permission denied error', () => {
      const error = createPermissionDeniedError('Permission denied', baseOptions);
      expect(error.code).toBe(NachosErrorCodes.PERMISSION_DENIED);
    });
  });

  describe('createNotFoundError', () => {
    it('should create not found error', () => {
      const error = createNotFoundError('Resource not found', baseOptions);
      expect(error.code).toBe(NachosErrorCodes.NOT_FOUND);
    });
  });

  describe('createAlreadyExistsError', () => {
    it('should create already exists error', () => {
      const error = createAlreadyExistsError('Resource already exists', baseOptions);
      expect(error.code).toBe(NachosErrorCodes.ALREADY_EXISTS);
    });
  });

  describe('createInvalidStateError', () => {
    it('should create invalid state error', () => {
      const error = createInvalidStateError('Invalid state', baseOptions);
      expect(error.code).toBe(NachosErrorCodes.INVALID_STATE);
    });
  });

  it('should include timestamp in all factory functions', () => {
    const error = createConfigError('Test', { component: 'test' });
    expect(error.timestamp).toBeDefined();
    expect(new Date(error.timestamp).toString()).not.toBe('Invalid Date');
  });
});

describe('Error Utilities', () => {
  describe('isNachosError', () => {
    it('should return true for NachosError', () => {
      const error = createConfigError('Test', { component: 'test' });
      expect(isNachosError(error)).toBe(true);
    });

    it('should return false for regular Error', () => {
      const error = new Error('Regular error');
      expect(isNachosError(error)).toBe(false);
    });

    it('should return false for non-error values', () => {
      expect(isNachosError(null)).toBe(false);
      expect(isNachosError(undefined)).toBe(false);
      expect(isNachosError('error string')).toBe(false);
      expect(isNachosError({ code: 'ERROR' })).toBe(false);
    });
  });

  describe('hasErrorCode', () => {
    it('should return true for matching error code', () => {
      const error = createValidationError('Test', { component: 'test' });
      expect(hasErrorCode(error, NachosErrorCodes.VALIDATION)).toBe(true);
    });

    it('should return false for non-matching error code', () => {
      const error = createValidationError('Test', { component: 'test' });
      expect(hasErrorCode(error, NachosErrorCodes.CONFIG)).toBe(false);
    });

    it('should return false for non-NachosError', () => {
      const error = new Error('Regular error');
      expect(hasErrorCode(error, NachosErrorCodes.INTERNAL)).toBe(false);
    });
  });

  describe('wrapError', () => {
    it('should return NachosError as-is', () => {
      const original = createConfigError('Original', { component: 'test' });
      const wrapped = wrapError(original, { component: 'wrapper' });
      expect(wrapped).toBe(original);
    });

    it('should wrap regular Error as internal error', () => {
      const original = new Error('Regular error');
      const wrapped = wrapError(original, { component: 'test' });

      expect(isNachosError(wrapped)).toBe(true);
      expect(wrapped.code).toBe(NachosErrorCodes.INTERNAL);
      expect(wrapped.message).toBe('Regular error');
      expect(wrapped.cause).toBe(original);
    });

    it('should wrap string as internal error', () => {
      const wrapped = wrapError('string error', { component: 'test' });

      expect(isNachosError(wrapped)).toBe(true);
      expect(wrapped.code).toBe(NachosErrorCodes.INTERNAL);
      expect(wrapped.message).toBe('string error');
    });

    it('should wrap non-error values', () => {
      const wrapped = wrapError(123, { component: 'test' });

      expect(isNachosError(wrapped)).toBe(true);
      expect(wrapped.message).toBe('123');
    });
  });

  describe('extractErrorInfo', () => {
    it('should extract info from NachosError', () => {
      const error = createValidationError('Validation failed', {
        component: 'gateway',
        details: { field: 'email' },
        correlationId: 'corr-123',
      });

      const info = extractErrorInfo(error);

      expect(info).toEqual({
        code: 'NACHOS_ERR_VALIDATION',
        message: 'Validation failed',
        component: 'gateway',
        details: { field: 'email' },
        timestamp: expect.any(String),
        correlationId: 'corr-123',
      });
    });

    it('should extract info from regular Error', () => {
      const error = new Error('Regular error');
      error.stack = 'Error: Regular error\n    at Test';

      const info = extractErrorInfo(error);

      expect(info).toEqual({
        name: 'Error',
        message: 'Regular error',
        stack: expect.stringContaining('Error: Regular error'),
      });
    });

    it('should handle non-error values', () => {
      const info = extractErrorInfo('string error');
      expect(info).toEqual({ message: 'string error' });
    });

    it('should handle null and undefined', () => {
      expect(extractErrorInfo(null)).toEqual({ message: 'null' });
      expect(extractErrorInfo(undefined)).toEqual({ message: 'undefined' });
    });
  });
});
