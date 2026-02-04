import type { AuditConfig } from '@nachos/config';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AuditProvider } from './provider.js';
import { CompositeAuditProvider } from './providers/composite.js';
import { FileAuditProvider } from './providers/file.js';
import { SQLiteAuditProvider } from './providers/sqlite.js';
import { WebhookAuditProvider } from './providers/webhook.js';

export async function loadAuditProvider(config: AuditConfig): Promise<AuditProvider> {
  const provider = config.provider ?? (config.providers ? 'composite' : 'sqlite');
  switch (provider) {
    case 'sqlite':
      return new SQLiteAuditProvider({
        path: config.path ?? './state/audit.db',
        flushIntervalMs: config.flush_interval_ms,
        batchSize: config.batch_size,
      });
    case 'file':
      return new FileAuditProvider({
        path: config.path ?? './state/audit.log',
        rotateSize: config.rotate_size,
        maxFiles: config.max_files,
        batchSize: config.batch_size,
        flushIntervalMs: config.flush_interval_ms,
      });
    case 'webhook':
      if (!config.url) {
        throw new Error('Audit webhook provider requires security.audit.url');
      }
      return new WebhookAuditProvider({
        url: config.url,
        headers: config.headers,
        batchSize: config.batch_size,
        flushIntervalMs: config.flush_interval_ms,
      });
    case 'custom': {
      if (!config.custom_path) {
        throw new Error('Audit custom provider requires security.audit.custom_path');
      }
      const resolvedPath = config.custom_path.startsWith('file:')
        ? config.custom_path
        : pathToFileURL(
            isAbsolute(config.custom_path)
              ? config.custom_path
              : resolve(process.cwd(), config.custom_path)
          ).href;
      const module = await import(resolvedPath);
      const Provider = module.default ?? module.AuditProvider;
      if (!Provider) {
        throw new Error('Audit custom provider module must export default or AuditProvider');
      }
      return new Provider(config.custom_config ?? {});
    }
    case 'composite': {
      const providerNames = config.providers ?? [];
      if (providerNames.includes('composite')) {
        throw new Error('Composite audit provider cannot include itself');
      }
      const baseConfig: AuditConfig = {
        enabled: config.enabled,
        path: config.path,
        rotate_size: config.rotate_size,
        max_files: config.max_files,
        url: config.url,
        headers: config.headers,
        batch_size: config.batch_size,
        flush_interval_ms: config.flush_interval_ms,
        custom_path: config.custom_path,
        custom_config: config.custom_config,
      };
      const providers = await Promise.all(
        providerNames.map((name) => loadAuditProvider({ ...baseConfig, provider: name as AuditConfig['provider'] }))
      );
      return new CompositeAuditProvider(providers);
    }
    default:
      throw new Error(`Unknown audit provider: ${provider}`);
  }
}
