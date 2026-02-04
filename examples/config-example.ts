#!/usr/bin/env node
/**
 * Example: Loading and Using Nachos Configuration
 * 
 * This example demonstrates how to load, validate, and use
 * the Nachos configuration system.
 */

import { loadAndValidateConfig } from '@nachos/config';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log('🧀 Nachos Configuration Example\n');

  try {
    // Load configuration from the example file in the root
    const configPath = path.join(__dirname, '..', 'nachos.toml.example');
    
    console.log(`Loading config from: ${configPath}\n`);
    
    const config = loadAndValidateConfig({
      configPath,
      applyEnv: true, // Apply environment variable overlays
      validate: true, // Validate the configuration
    });

    console.log('✅ Configuration loaded and validated successfully!\n');

    // Display core settings
    console.log('📋 Core Settings:');
    console.log(`  Name: ${config.nachos.name}`);
    console.log(`  Version: ${config.nachos.version}\n`);

    // Display LLM configuration
    console.log('🤖 LLM Configuration:');
    console.log(`  Provider: ${config.llm.provider}`);
    console.log(`  Model: ${config.llm.model}`);
    console.log(`  Max Tokens: ${config.llm.max_tokens ?? 'default'}`);
    console.log(`  Temperature: ${config.llm.temperature ?? 'default'}\n`);

    // Display security settings
    console.log('🔒 Security Settings:');
    console.log(`  Mode: ${config.security.mode}`);
    console.log(`  DLP Enabled: ${config.security.dlp?.enabled ?? false}`);
    console.log(`  Audit Enabled: ${config.security.audit?.enabled ?? false}\n`);

    // Display enabled channels
    console.log('📡 Channels:');
    if (config.channels) {
      const enabledChannels = Object.entries(config.channels)
        .filter(([_, cfg]) => cfg && cfg.enabled !== false)
        .map(([name, _]) => name);
      
      if (enabledChannels.length > 0) {
        enabledChannels.forEach((name) => console.log(`  ✓ ${name}`));
      } else {
        console.log('  (none enabled)');
      }
    } else {
      console.log('  (none configured)');
    }
    console.log();

    // Display enabled tools
    console.log('🛠️  Tools:');
    if (config.tools) {
      const enabledTools = Object.entries(config.tools)
        .filter(([_, cfg]) => cfg?.enabled)
        .map(([name, _]) => name);
      
      if (enabledTools.length > 0) {
        enabledTools.forEach((name) => console.log(`  ✓ ${name}`));
      } else {
        console.log('  (none enabled)');
      }
    } else {
      console.log('  (none configured)');
    }
    console.log();

    // Display runtime settings
    if (config.runtime) {
      console.log('⚙️  Runtime Settings:');
      console.log(`  Log Level: ${config.runtime.log_level ?? 'info'}`);
      console.log(`  Log Format: ${config.runtime.log_format ?? 'pretty'}`);
      console.log(`  State Dir: ${config.runtime.state_dir ?? './state'}\n`);
    }

    // Display assistant settings
    if (config.assistant) {
      console.log('🤝 Assistant Settings:');
      console.log(`  Name: ${config.assistant.name ?? 'Nachos'}`);
      if (config.assistant.system_prompt) {
        console.log(`  System Prompt: ${config.assistant.system_prompt.substring(0, 50)}...`);
      }
      console.log();
    }

    console.log('✨ All configuration values are ready to use!\n');

    // Example: Using configuration in application logic
    console.log('📝 Example Usage:');
    console.log(`  if (config.security.mode === 'strict') {`);
    console.log(`    // Apply strict security policies`);
    console.log(`  }\n`);

    console.log(`  if (config.tools?.filesystem?.enabled) {`);
    console.log(`    // Enable filesystem tool`);
    console.log(`  }\n`);

  } catch (error) {
    if (error instanceof Error) {
      console.error('❌ Error:', error.message);
      if ('errors' in error) {
        console.error('\nValidation errors:');
        (error as { errors: string[] }).errors.forEach((err) => {
          console.error(`  - ${err}`);
        });
      }
    }
    process.exit(1);
  }
}

main().catch(console.error);
