/**
 * Context Budget Calculator Tests
 */

import { describe, it, expect } from 'vitest';
import {
  ContextBudgetCalculator,
  formatContextBudget,
  shouldCompact,
  getCompactionUrgency,
} from './calculator.js';
import type { ContextMessage } from '../types/index.js';

describe('ContextBudgetCalculator', () => {
  const createMessages = (count: number, tokensEach: number = 100): ContextMessage[] => {
    return Array.from({ length: count }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: 'x'.repeat(Math.floor(tokensEach * 3.5)), // chars = tokens * 3.5
    }));
  };

  describe('calculate()', () => {
    it('should calculate budget for empty messages', () => {
      const calculator = new ContextBudgetCalculator();
      const budget = calculator.calculate({
        messages: [],
        systemPromptTokens: 1000,
        contextWindow: 200000,
        reserveTokens: 10000,
      });

      expect(budget.total).toBe(200000);
      expect(budget.systemPrompt).toBe(1000);
      expect(budget.reserved).toBe(10000);
      expect(budget.historyBudget).toBe(189000); // 200000 - 1000 - 10000
      expect(budget.currentUsage).toBe(0);
      expect(budget.utilizationRatio).toBe(0);
      expect(budget.zone).toBe('green');
    });

    it('should calculate budget with messages', () => {
      const calculator = new ContextBudgetCalculator();
      const messages = createMessages(10, 100); // 10 messages * 100 tokens = ~1000 tokens

      const budget = calculator.calculate({
        messages,
        systemPromptTokens: 5000,
        contextWindow: 200000,
        reserveTokens: 20000,
      });

      expect(budget.currentUsage).toBeGreaterThan(0);
      expect(budget.historyBudget).toBe(175000); // 200000 - 5000 - 20000
      expect(budget.utilizationRatio).toBeGreaterThan(0);
      expect(budget.utilizationRatio).toBeLessThan(0.1); // Low usage
    });

    it('should determine correct zones', () => {
      const calculator = new ContextBudgetCalculator();
      const contextWindow = 100000;
      const systemPromptTokens = 0;
      const reserveTokens = 0;

      // Green zone (0-60%)
      let messages = createMessages(500, 100); // ~50k tokens = 50%
      let budget = calculator.calculate({ messages, systemPromptTokens, contextWindow, reserveTokens });
      expect(budget.zone).toBe('green');

      // Yellow zone (60-75%)
      messages = createMessages(650, 100); // ~65k tokens = 65%
      budget = calculator.calculate({ messages, systemPromptTokens, contextWindow, reserveTokens });
      expect(budget.zone).toBe('yellow');

      // Orange zone (75-85%)
      messages = createMessages(800, 100); // ~80k tokens = 80%
      budget = calculator.calculate({ messages, systemPromptTokens, contextWindow, reserveTokens });
      expect(budget.zone).toBe('orange');

      // Red zone (85-95%)
      messages = createMessages(900, 100); // ~90k tokens = 90%
      budget = calculator.calculate({ messages, systemPromptTokens, contextWindow, reserveTokens });
      expect(budget.zone).toBe('red');

      // Critical zone (95%+)
      messages = createMessages(970, 100); // ~97k tokens = 97%
      budget = calculator.calculate({ messages, systemPromptTokens, contextWindow, reserveTokens });
      expect(budget.zone).toBe('critical');
    });

    it('should handle full context window', () => {
      const calculator = new ContextBudgetCalculator();
      const messages = createMessages(2000, 100); // Way more than budget

      const budget = calculator.calculate({
        messages,
        systemPromptTokens: 10000,
        contextWindow: 200000,
        reserveTokens: 10000,
      });

      expect(budget.utilizationRatio).toBeGreaterThan(1); // Over budget
      expect(budget.zone).toBe('critical');
    });
  });

  describe('determineZone()', () => {
    const calculator = new ContextBudgetCalculator();
    const defaultThresholds = {
      proactivePrune: 0.6,
      lightCompaction: 0.75,
      aggressiveCompaction: 0.85,
      emergency: 0.95,
    };

    it('should return green for low utilization', () => {
      expect(calculator.determineZone(0.0, defaultThresholds)).toBe('green');
      expect(calculator.determineZone(0.3, defaultThresholds)).toBe('green');
      expect(calculator.determineZone(0.59, defaultThresholds)).toBe('green');
    });

    it('should return yellow for moderate utilization', () => {
      expect(calculator.determineZone(0.6, defaultThresholds)).toBe('yellow');
      expect(calculator.determineZone(0.7, defaultThresholds)).toBe('yellow');
      expect(calculator.determineZone(0.74, defaultThresholds)).toBe('yellow');
    });

    it('should return orange for high utilization', () => {
      expect(calculator.determineZone(0.75, defaultThresholds)).toBe('orange');
      expect(calculator.determineZone(0.8, defaultThresholds)).toBe('orange');
      expect(calculator.determineZone(0.84, defaultThresholds)).toBe('orange');
    });

    it('should return red for very high utilization', () => {
      expect(calculator.determineZone(0.85, defaultThresholds)).toBe('red');
      expect(calculator.determineZone(0.9, defaultThresholds)).toBe('red');
      expect(calculator.determineZone(0.94, defaultThresholds)).toBe('red');
    });

    it('should return critical for critical utilization', () => {
      expect(calculator.determineZone(0.95, defaultThresholds)).toBe('critical');
      expect(calculator.determineZone(1.0, defaultThresholds)).toBe('critical');
      expect(calculator.determineZone(1.1, defaultThresholds)).toBe('critical');
    });
  });

  describe('calculateCompactionTarget()', () => {
    const calculator = new ContextBudgetCalculator();

    it('should calculate target for yellow zone', () => {
      const messages = createMessages(100, 100);
      const budget = calculator.calculate({
        messages,
        systemPromptTokens: 0,
        contextWindow: 100000,
        reserveTokens: 0,
      });

      const target = calculator.calculateCompactionTarget(budget, 'yellow');
      expect(target.targetTokens).toBeGreaterThan(0);
      expect(target.dropRatio).toBe(0.2); // 20% drop for yellow
    });

    it('should calculate target for red zone', () => {
      const messages = createMessages(100, 100);
      const budget = calculator.calculate({
        messages,
        systemPromptTokens: 0,
        contextWindow: 100000,
        reserveTokens: 0,
      });

      const target = calculator.calculateCompactionTarget(budget, 'red');
      expect(target.targetTokens).toBeGreaterThan(0);
      expect(target.dropRatio).toBe(0.4); // 40% drop for red
    });
  });
});

describe('Utility functions', () => {
  describe('formatContextBudget()', () => {
    it('should format budget as readable string', () => {
      const budget = {
        total: 200000,
        systemPrompt: 10000,
        reserved: 20000,
        historyBudget: 170000,
        currentUsage: 85000,
        utilizationRatio: 0.5,
        zone: 'green' as const,
      };

      const formatted = formatContextBudget(budget);
      expect(formatted).toContain('170,000'); // historyBudget, not total
      expect(formatted).toContain('85,000');
      expect(formatted).toContain('50.0%');
      expect(formatted).toContain('🟢'); // green zone emoji
    });
  });

  describe('shouldCompact()', () => {
    const defaultThresholds = {
      proactivePrune: 0.6,
      lightCompaction: 0.75,
      aggressiveCompaction: 0.85,
      emergency: 0.95,
    };

    it('should return false for green zone', () => {
      const budget = {
        total: 100000,
        systemPrompt: 0,
        reserved: 0,
        historyBudget: 100000,
        currentUsage: 50000,
        utilizationRatio: 0.5,
        zone: 'green' as const,
      };

      expect(shouldCompact(budget, defaultThresholds)).toBe(false);
    });

    it('should return true for yellow zone and above', () => {
      const zones: Array<'yellow' | 'orange' | 'red' | 'critical'> = [
        'yellow',
        'orange',
        'red',
        'critical',
      ];

      zones.forEach((zone) => {
        const budget = {
          total: 100000,
          systemPrompt: 0,
          reserved: 0,
          historyBudget: 100000,
          currentUsage: 76000,
          utilizationRatio: 0.76,
          zone,
        };

        expect(shouldCompact(budget, defaultThresholds)).toBe(true);
      });
    });
  });

  describe('getCompactionUrgency()', () => {
    it('should return none for green zone', () => {
      const budget = {
        total: 100000,
        systemPrompt: 0,
        reserved: 0,
        historyBudget: 100000,
        currentUsage: 50000,
        utilizationRatio: 0.5,
        zone: 'green' as const,
      };

      expect(getCompactionUrgency(budget)).toBe('none');
    });

    it('should return low for yellow zone', () => {
      const budget = {
        total: 100000,
        systemPrompt: 0,
        reserved: 0,
        historyBudget: 100000,
        currentUsage: 65000,
        utilizationRatio: 0.65,
        zone: 'yellow' as const,
      };

      expect(getCompactionUrgency(budget)).toBe('low');
    });

    it('should return medium for orange zone', () => {
      const budget = {
        total: 100000,
        systemPrompt: 0,
        reserved: 0,
        historyBudget: 100000,
        currentUsage: 80000,
        utilizationRatio: 0.8,
        zone: 'orange' as const,
      };

      expect(getCompactionUrgency(budget)).toBe('medium');
    });

    it('should return high for red zone', () => {
      const budget = {
        total: 100000,
        systemPrompt: 0,
        reserved: 0,
        historyBudget: 100000,
        currentUsage: 90000,
        utilizationRatio: 0.9,
        zone: 'red' as const,
      };

      expect(getCompactionUrgency(budget)).toBe('high');
    });

    it('should return critical for critical zone', () => {
      const budget = {
        total: 100000,
        systemPrompt: 0,
        reserved: 0,
        historyBudget: 100000,
        currentUsage: 96000,
        utilizationRatio: 0.96,
        zone: 'critical' as const,
      };

      expect(getCompactionUrgency(budget)).toBe('critical');
    });
  });
});
