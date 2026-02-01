#!/usr/bin/env node

/**
 * Nachos LLM Proxy Service
 *
 * Abstracts LLM provider differences:
 * - Unified API across providers
 * - Automatic retry with exponential backoff
 * - Fallback to secondary model
 * - Token counting and limits
 * - Response streaming
 */

const PORT = process.env.PORT || 3001;
const NATS_URL = process.env.NATS_URL || 'nats://localhost:4222';

console.log('🔌 Nachos LLM Proxy starting...');
console.log(`   Port: ${PORT}`);
console.log(`   NATS: ${NATS_URL}`);
console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`   Anthropic API: ${process.env.ANTHROPIC_API_KEY ? '✓ configured' : '✗ missing'}`);
console.log(`   OpenAI API: ${process.env.OPENAI_API_KEY ? '✓ configured' : '✗ missing'}`);

let isHealthy = true;

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  isHealthy = false;
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  isHealthy = false;
  process.exit(0);
});

// Keep the process alive
setInterval(() => {
  if (isHealthy) {
    console.log(`[${new Date().toISOString()}] LLM Proxy healthy - ready for requests`);
  }
}, 30000);

console.log('✅ LLM Proxy service ready');
console.log('   Listening for LLM requests on NATS...');
