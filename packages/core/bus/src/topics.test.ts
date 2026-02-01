import { describe, it, expect } from 'vitest';
import {
  TOPICS,
  TOPIC_PREFIX,
  CHANNEL_TOPICS,
  LLM_TOPICS,
  TOOL_TOPICS,
  POLICY_TOPICS,
  AUDIT_TOPICS,
  HEALTH_TOPICS,
  extractChannelFromTopic,
  extractToolFromTopic,
  extractSessionFromStreamTopic,
} from './topics.js';

describe('Topics', () => {
  describe('TOPIC_PREFIX', () => {
    it('should be "nachos"', () => {
      expect(TOPIC_PREFIX).toBe('nachos');
    });
  });

  describe('CHANNEL_TOPICS', () => {
    it('should generate correct inbound topic', () => {
      expect(CHANNEL_TOPICS.inbound('slack')).toBe('nachos.channel.slack.inbound');
      expect(CHANNEL_TOPICS.inbound('discord')).toBe('nachos.channel.discord.inbound');
      expect(CHANNEL_TOPICS.inbound('telegram')).toBe('nachos.channel.telegram.inbound');
    });

    it('should generate correct outbound topic', () => {
      expect(CHANNEL_TOPICS.outbound('slack')).toBe('nachos.channel.slack.outbound');
      expect(CHANNEL_TOPICS.outbound('discord')).toBe('nachos.channel.discord.outbound');
      expect(CHANNEL_TOPICS.outbound('webchat')).toBe('nachos.channel.webchat.outbound');
    });

    it('should have correct wildcard topics', () => {
      expect(CHANNEL_TOPICS.allInbound).toBe('nachos.channel.*.inbound');
      expect(CHANNEL_TOPICS.allOutbound).toBe('nachos.channel.*.outbound');
    });
  });

  describe('LLM_TOPICS', () => {
    it('should have correct request topic', () => {
      expect(LLM_TOPICS.request).toBe('nachos.llm.request');
    });

    it('should have correct response topic', () => {
      expect(LLM_TOPICS.response).toBe('nachos.llm.response');
    });

    it('should generate correct stream topic', () => {
      expect(LLM_TOPICS.stream('session-123')).toBe('nachos.llm.stream.session-123');
      expect(LLM_TOPICS.stream('abc-456')).toBe('nachos.llm.stream.abc-456');
    });

    it('should have correct wildcard stream topic', () => {
      expect(LLM_TOPICS.allStreams).toBe('nachos.llm.stream.*');
    });
  });

  describe('TOOL_TOPICS', () => {
    it('should generate correct request topic', () => {
      expect(TOOL_TOPICS.request('filesystem')).toBe('nachos.tool.filesystem.request');
      expect(TOOL_TOPICS.request('browser')).toBe('nachos.tool.browser.request');
    });

    it('should generate correct response topic', () => {
      expect(TOOL_TOPICS.response('filesystem')).toBe('nachos.tool.filesystem.response');
      expect(TOOL_TOPICS.response('code-runner')).toBe('nachos.tool.code-runner.response');
    });

    it('should have correct wildcard topics', () => {
      expect(TOOL_TOPICS.allRequests).toBe('nachos.tool.*.request');
      expect(TOOL_TOPICS.allResponses).toBe('nachos.tool.*.response');
    });
  });

  describe('POLICY_TOPICS', () => {
    it('should have correct check topic', () => {
      expect(POLICY_TOPICS.check).toBe('nachos.policy.check');
    });

    it('should have correct result topic', () => {
      expect(POLICY_TOPICS.result).toBe('nachos.policy.result');
    });
  });

  describe('AUDIT_TOPICS', () => {
    it('should have correct log topic', () => {
      expect(AUDIT_TOPICS.log).toBe('nachos.audit.log');
    });
  });

  describe('HEALTH_TOPICS', () => {
    it('should have correct ping topic', () => {
      expect(HEALTH_TOPICS.ping).toBe('nachos.health.ping');
    });
  });

  describe('TOPICS namespace', () => {
    it('should contain all topic groups', () => {
      expect(TOPICS.channel).toBe(CHANNEL_TOPICS);
      expect(TOPICS.llm).toBe(LLM_TOPICS);
      expect(TOPICS.tool).toBe(TOOL_TOPICS);
      expect(TOPICS.policy).toBe(POLICY_TOPICS);
      expect(TOPICS.audit).toBe(AUDIT_TOPICS);
      expect(TOPICS.health).toBe(HEALTH_TOPICS);
    });
  });

  describe('extractChannelFromTopic', () => {
    it('should extract channel from inbound topic', () => {
      expect(extractChannelFromTopic('nachos.channel.slack.inbound')).toBe('slack');
      expect(extractChannelFromTopic('nachos.channel.discord.inbound')).toBe('discord');
    });

    it('should extract channel from outbound topic', () => {
      expect(extractChannelFromTopic('nachos.channel.telegram.outbound')).toBe('telegram');
      expect(extractChannelFromTopic('nachos.channel.webchat.outbound')).toBe('webchat');
    });

    it('should return null for invalid topics', () => {
      expect(extractChannelFromTopic('nachos.llm.request')).toBeNull();
      expect(extractChannelFromTopic('nachos.channel.slack')).toBeNull();
      expect(extractChannelFromTopic('invalid')).toBeNull();
      expect(extractChannelFromTopic('')).toBeNull();
    });
  });

  describe('extractToolFromTopic', () => {
    it('should extract tool from request topic', () => {
      expect(extractToolFromTopic('nachos.tool.filesystem.request')).toBe('filesystem');
      expect(extractToolFromTopic('nachos.tool.browser.request')).toBe('browser');
    });

    it('should extract tool from response topic', () => {
      expect(extractToolFromTopic('nachos.tool.code-runner.response')).toBe('code-runner');
      expect(extractToolFromTopic('nachos.tool.shell.response')).toBe('shell');
    });

    it('should return null for invalid topics', () => {
      expect(extractToolFromTopic('nachos.llm.request')).toBeNull();
      expect(extractToolFromTopic('nachos.tool.filesystem')).toBeNull();
      expect(extractToolFromTopic('invalid')).toBeNull();
      expect(extractToolFromTopic('')).toBeNull();
    });
  });

  describe('extractSessionFromStreamTopic', () => {
    it('should extract session ID from stream topic', () => {
      expect(extractSessionFromStreamTopic('nachos.llm.stream.session-123')).toBe('session-123');
      expect(extractSessionFromStreamTopic('nachos.llm.stream.abc-456-def')).toBe('abc-456-def');
    });

    it('should return null for invalid topics', () => {
      expect(extractSessionFromStreamTopic('nachos.llm.request')).toBeNull();
      expect(extractSessionFromStreamTopic('nachos.llm.stream')).toBeNull();
      expect(extractSessionFromStreamTopic('invalid')).toBeNull();
      expect(extractSessionFromStreamTopic('')).toBeNull();
    });
  });
});
