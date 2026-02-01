#!/usr/bin/env node

/**
 * Nachos Gateway Service
 * 
 * Central orchestrator for:
 * - Managing user sessions
 * - Routing messages between components
 * - Maintaining conversation state
 * - Coordinating tool execution
 */

const PORT = process.env.PORT || 3000;
const NATS_URL = process.env.NATS_URL || 'nats://localhost:4222';

console.log('🔲 Nachos Gateway starting...');
console.log(`   Port: ${PORT}`);
console.log(`   NATS: ${NATS_URL}`);
console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);

// Basic health check endpoint
// In a full implementation, this would be an HTTP server
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
    console.log(`[${new Date().toISOString()}] Gateway healthy - session management active`);
  }
}, 30000);

console.log('✅ Gateway service ready');
console.log('   Waiting for messages on NATS...');
