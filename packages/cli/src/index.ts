#!/usr/bin/env node

/**
 * Nachos CLI entry point
 */

import { createProgram } from './cli.js';

// Clean exit on SIGINT (Ctrl-C) — standard Unix exit code 128 + signal 2
process.on('SIGINT', () => {
  console.log();
  process.exit(130);
});

const program = createProgram();

program.parse(process.argv);
