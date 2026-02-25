/**
 * Tests for model selection logic
 */

import { describe, it, expect } from 'vitest';
import {
  selectModel,
  DEFAULT_MODEL_ALIASES,
  getModelName,
  getModelCostMultiplier,
} from './model-selection.js';

describe('Model Selection', () => {
  describe('selectModel', () => {
    it('should use explicit model when provided', () => {
      const model = selectModel(
        'Simple task',
        { model: 'opus' },
        {}
      );
      
      expect(model).toBe(DEFAULT_MODEL_ALIASES['opus']);
    });

    it('should resolve full model IDs without aliases', () => {
      const fullModelId = 'anthropic.claude-3-sonnet-20240229-v1:0';
      const model = selectModel(
        'Simple task',
        { model: fullModelId },
        {}
      );
      
      expect(model).toBe(fullModelId);
    });

    it('should use modelHint when provided', () => {
      const model = selectModel(
        'Simple task',
        { modelHint: 'fast' },
        {}
      );
      
      expect(model).toBe(DEFAULT_MODEL_ALIASES['fast']);
    });

    it('should prioritize explicit model over modelHint', () => {
      const model = selectModel(
        'Simple task',
        { model: 'opus', modelHint: 'fast' },
        {}
      );
      
      expect(model).toBe(DEFAULT_MODEL_ALIASES['opus']);
    });

    it('should auto-select haiku for simple short tasks', () => {
      const model = selectModel(
        'Check syntax',
        {},
        { autoSelect: true }
      );
      
      expect(model).toBe(DEFAULT_MODEL_ALIASES['fast']);
    });

    it('should auto-select opus for complex code analysis', () => {
      const model = selectModel(
        'Analyze this codebase for security vulnerabilities and provide a comprehensive audit report',
        {},
        { autoSelect: true }
      );
      
      expect(model).toBe(DEFAULT_MODEL_ALIASES['thorough']);
    });

    it('should auto-select opus for code-related tasks', () => {
      const model = selectModel(
        'Review the code in this repository and identify potential bugs',
        {},
        { autoSelect: true }
      );
      
      expect(model).toBe(DEFAULT_MODEL_ALIASES['thorough']);
    });

    it('should auto-select opus for multi-step tasks', () => {
      const model = selectModel(
        'First analyze the data, then write a report, and finally create visualizations',
        {},
        { autoSelect: true }
      );
      
      expect(model).toBe(DEFAULT_MODEL_ALIASES['thorough']);
    });

    it('should auto-select sonnet for medium complexity tasks', () => {
      const model = selectModel(
        'Summarize this article and identify the key points',
        {},
        { autoSelect: true }
      );
      
      expect(model).toBe(DEFAULT_MODEL_ALIASES['balanced']);
    });

    it('should use custom aliases when provided', () => {
      const model = selectModel(
        'Simple task',
        { model: 'custom-fast' },
        {
          aliases: {
            'custom-fast': 'my-custom-model-id',
          },
        }
      );
      
      expect(model).toBe('my-custom-model-id');
    });

    it('should handle custom aliases case-insensitively', () => {
      const config = {
        aliases: {
          'My-Custom-Fast': 'my-custom-model-id',
          'CUSTOM_SLOW': 'another-model-id',
        },
      };

      expect(selectModel('Task', { model: 'my-custom-fast' }, config))
        .toBe('my-custom-model-id');
      
      expect(selectModel('Task', { model: 'custom_slow' }, config))
        .toBe('another-model-id');
      
      expect(selectModel('Task', { model: 'CUSTOM_SLOW' }, config))
        .toBe('another-model-id');
    });

    it('should use defaultModel from config when no auto-select', () => {
      const model = selectModel(
        'Some task',
        {},
        {
          autoSelect: false,
          defaultModel: 'opus',
        }
      );
      
      expect(model).toBe(DEFAULT_MODEL_ALIASES['opus']);
    });

    it('should fallback to sonnet when no hints or config', () => {
      const model = selectModel(
        'Some task',
        {},
        { autoSelect: false }
      );
      
      expect(model).toBe(DEFAULT_MODEL_ALIASES['balanced']);
    });

    it('should handle numbered lists as multi-step', () => {
      const model = selectModel(
        `Please do the following:
        1. Analyze the data
        2. Write a report
        3. Create charts`,
        {},
        { autoSelect: true }
      );
      
      expect(model).toBe(DEFAULT_MODEL_ALIASES['thorough']);
    });

    it('should handle very long task descriptions', () => {
      const longTask = 'word '.repeat(60) + 'end'; // 61 words
      const model = selectModel(
        longTask,
        {},
        { autoSelect: true }
      );
      
      expect(model).toBe(DEFAULT_MODEL_ALIASES['thorough']);
    });

    it('should recognize all model hint values', () => {
      const hints: Array<'fast' | 'balanced' | 'thorough'> = ['fast', 'balanced', 'thorough'];
      
      for (const hint of hints) {
        const model = selectModel('Task', { modelHint: hint }, {});
        expect(model).toBe(DEFAULT_MODEL_ALIASES[hint]);
      }
    });

    it('should handle case-insensitive alias resolution', () => {
      const model = selectModel(
        'Task',
        { model: 'HAIKU' },
        {}
      );
      
      expect(model).toBe(DEFAULT_MODEL_ALIASES['haiku']);
    });
  });

  describe('getModelName', () => {
    it('should return human-readable names for standard models', () => {
      expect(getModelName('anthropic.claude-3-haiku-20240307-v1:0')).toBe('Claude 3 Haiku');
      expect(getModelName('anthropic.claude-3-5-sonnet-20241022-v2:0')).toBe('Claude 3.5 Sonnet');
      expect(getModelName('anthropic.claude-3-opus-20240229-v1:0')).toBe('Claude 3 Opus');
    });

    it('should return model ID for unknown models', () => {
      expect(getModelName('unknown-model-id')).toBe('unknown-model-id');
    });
  });

  describe('getModelCostMultiplier', () => {
    it('should return correct cost multipliers', () => {
      expect(getModelCostMultiplier('anthropic.claude-3-haiku-20240307-v1:0')).toBe(1.0);
      expect(getModelCostMultiplier('anthropic.claude-3-5-sonnet-20241022-v2:0')).toBe(12.0);
      expect(getModelCostMultiplier('anthropic.claude-3-opus-20240229-v1:0')).toBe(60.0);
    });

    it('should default to 1.0 for unknown models', () => {
      expect(getModelCostMultiplier('unknown-model')).toBe(1.0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty task string', () => {
      const model = selectModel(
        '',
        {},
        { autoSelect: true }
      );
      
      // Empty task is short, should select Haiku
      expect(model).toBe(DEFAULT_MODEL_ALIASES['fast']);
    });

    it('should handle task with only whitespace', () => {
      const model = selectModel(
        '   \n   \t   ',
        {},
        { autoSelect: true }
      );
      
      expect(model).toBe(DEFAULT_MODEL_ALIASES['fast']);
    });

    it('should handle task with special characters', () => {
      const model = selectModel(
        'Fix bug: @#$%^&*()',
        {},
        { autoSelect: true }
      );
      
      // Short task, should use Haiku
      expect(model).toBe(DEFAULT_MODEL_ALIASES['fast']);
    });

    it('should handle undefined options gracefully', () => {
      const model = selectModel(
        'Simple task',
        {},
        undefined
      );
      
      expect(model).toBe(DEFAULT_MODEL_ALIASES['balanced']);
    });
  });

  describe('Keyword Detection', () => {
    const codeKeywords = [
      'analyze code',
      'review codebase',
      'audit repository',
      'find bugs',
      'security vulnerabilities',
      'refactor function',
      'optimize module',
    ];

    const complexKeywords = [
      'comprehensive analysis',
      'detailed review',
      'thorough investigation',
      'research topic',
      'compare alternatives',
      'evaluate options',
    ];

    it('should detect code-related keywords', () => {
      for (const task of codeKeywords) {
        const model = selectModel(task, {}, { autoSelect: true });
        expect(model).toBe(DEFAULT_MODEL_ALIASES['thorough']);
      }
    });

    it('should detect complex task keywords', () => {
      for (const task of complexKeywords) {
        const model = selectModel(task, {}, { autoSelect: true });
        expect(model).toBe(DEFAULT_MODEL_ALIASES['thorough']);
      }
    });
  });
});
