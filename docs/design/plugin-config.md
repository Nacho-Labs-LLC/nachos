# Plugin Configuration System

> **Status**: Design
> **Author**: Backend Architect
> **Date**: 2026-03-04
> **Related ADRs**: ADR-001 (Module Manifest), ADR-003 (Security Modes)

## Problem Statement

Nachos currently has a fixed configuration schema defined in `@nachos/config`.
Every channel, tool, and component has its config shape hardcoded in
`schema.ts`, `validation.ts`, and `CONFIG_SHAPE`. When a new plugin is added,
three files must be updated in lockstep.

Plugins (community channels, third-party tools, custom integrations) need a way
to declare their own configuration sections in `nachos.toml` without modifying
the core config package. The system must validate plugin config at startup,
provide clear errors for typos, and enforce isolation so plugins cannot read
each other's config.

## Design Goals

1. **Self-describing plugins** -- each plugin declares its config schema in a
   manifest file, no changes to core required.
2. **Validated at startup** -- plugin config is validated against its declared
   schema before the plugin is initialized.
3. **Typo protection** -- unknown keys in `[plugins.*]` sections are rejected,
   just like unknown keys in core config.
4. **Isolation** -- a plugin receives only its own config section, never core
   config or other plugins' config.
5. **Backward compatible** -- existing `nachos.toml` files without a `[plugins]`
   section continue to work. Existing `[channels.*]` and `[tools.*]` sections
   are not affected.
6. **No heavy dependencies** -- validation uses a lightweight JSON Schema
   subset, not a full validator library.

## TOML Surface

Plugins declare config under `[plugins.<plugin-id>]`:

```toml
[plugins.my-webhook]
url = "https://hooks.example.com/nachos"
secret = "${WEBHOOK_SECRET}"
retry_count = 3
enabled = true

[plugins.custom-llm-cache]
enabled = true
ttl_seconds = 600
max_entries = 1000
```

Plugin IDs follow the same slug rules as channel/tool names: lowercase
alphanumeric plus hyphens, 1-64 characters.

## Plugin Config Schema Declaration

Each plugin ships a `nachos-plugin.json` manifest (or includes a `configSchema`
field in its existing `manifest.json`). The config schema uses a subset of JSON
Schema Draft-07:

```json
{
  "id": "my-webhook",
  "version": "1.0.0",
  "configSchema": {
    "type": "object",
    "properties": {
      "enabled": { "type": "boolean", "default": true },
      "url": { "type": "string" },
      "secret": { "type": "string" },
      "retry_count": { "type": "number", "default": 3 }
    },
    "required": ["url"]
  }
}
```

### Supported JSON Schema Subset

The lightweight validator supports:

| Feature | Supported |
|---------|-----------|
| `type` (string, number, boolean, array, object) | Yes |
| `required` (array of field names) | Yes |
| `properties` (nested object schemas) | Yes |
| `default` (default values) | Yes |
| `enum` (allowed values) | Yes |
| `items` (array item type) | Yes, single type only |
| `minLength`, `maxLength` | Yes |
| `minimum`, `maximum` | Yes |
| `pattern` (regex) | No (ReDoS risk) |
| `$ref` | No |
| `oneOf`, `anyOf`, `allOf` | No |
| `additionalProperties` | Yes (boolean only) |

This subset covers the vast majority of plugin config needs without the
complexity or security risks of a full JSON Schema implementation.

## Architecture

### Components

```
nachos-plugin.json          nachos.toml
  (schema)                  (values)
       \                     /
        \                   /
    PluginConfigRegistry.register()
              |
    PluginConfigRegistry.validate()
              |
        validated config
              |
    plugin receives its section
```

### PluginConfigSchema

TypeScript type describing what a plugin declares in its manifest:

```typescript
interface PluginConfigPropertySchema {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  default?: unknown;
  enum?: unknown[];
  items?: PluginConfigPropertySchema;
  properties?: Record<string, PluginConfigPropertySchema>;
  required?: string[];
  additionalProperties?: boolean;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
}

interface PluginConfigSchema {
  type: 'object';
  properties: Record<string, PluginConfigPropertySchema>;
  required?: string[];
  additionalProperties?: boolean;
}
```

### PluginConfigRegistry

Central registry that:

1. Accepts plugin schema registrations (called during discovery/startup).
2. Validates a plugin's config values against its registered schema.
3. Applies defaults for missing optional fields.
4. Rejects unknown keys when `additionalProperties` is false (the default).

```typescript
class PluginConfigRegistry {
  register(pluginId: string, schema: PluginConfigSchema): void;
  validate(pluginId: string, config: Record<string, unknown>): PluginConfigValidationResult;
  applyDefaults(pluginId: string, config: Record<string, unknown>): Record<string, unknown>;
  getRegisteredPlugins(): string[];
  hasPlugin(pluginId: string): boolean;
}
```

### Validation Flow

At startup:

1. Config loader reads `nachos.toml` as today.
2. Plugin discovery scans for `nachos-plugin.json` manifests.
3. Each manifest's `configSchema` is registered with `PluginConfigRegistry`.
4. For each `[plugins.<id>]` section in the TOML:
   a. If `id` has no registered schema, emit error (typo protection).
   b. If `id` has a schema, validate the section against it.
   c. Apply defaults for missing optional fields.
5. Validated config sections are passed to plugins during initialization.

### Plugin Config Access

Plugins receive their config through context injection, not by reading
`nachos.toml` directly:

```typescript
// Plugin initialization receives only its own config
interface PluginContext {
  config: Record<string, unknown>;  // The validated [plugins.<id>] section
  logger: Logger;
  // ... other context
}
```

A plugin cannot access:
- Core config sections (`[nachos]`, `[llm]`, `[security]`, etc.)
- Other plugins' config sections
- The raw TOML content

## Integration Points

### With Existing CONFIG_SHAPE (validation.ts)

The `plugins` key is added to `CONFIG_SHAPE` as a pass-through marker (`true`),
meaning the existing unknown-key validator will not reject `[plugins.*]`
sections. Plugin-level validation is handled separately by
`PluginConfigRegistry`.

This change is deferred to the integration phase. The plugin-config
infrastructure is self-contained and testable independently.

### With Config Loader (loader.ts / main.ts)

The integration phase will:

1. Add a `plugins?: Record<string, Record<string, unknown>>` field to
   `NachosConfig`.
2. After loading TOML, iterate `config.plugins` entries and validate each
   against the registry.
3. Apply defaults and freeze the validated config before passing to plugins.

### With Module Manifest (manifest.json)

Existing channel/tool manifests define capabilities (network, secrets, security
tier). The `configSchema` field is a natural extension:

```json
{
  "name": "my-channel",
  "type": "channel",
  "capabilities": { ... },
  "configSchema": { ... }
}
```

## Security Considerations

1. **No `pattern` support** -- Regular expression patterns in schemas could
   introduce ReDoS vulnerabilities. Plugins that need regex validation should
   do it in their own initialization code.

2. **Default values are type-checked** -- A schema declaring
   `{ "type": "number", "default": "oops" }` is rejected at registration time.

3. **Plugin ID validation** -- Plugin IDs are validated against a strict slug
   pattern to prevent path traversal or injection in config keys.

4. **Config isolation** -- Plugins receive a deep copy of their config section,
   preventing mutation of the shared config object.

5. **No secret interpolation in schemas** -- Default values must not contain
   `${...}` environment variable references. Secret interpolation happens at
   the TOML loading layer, before plugin validation.

## Backward Compatibility

- A `nachos.toml` without `[plugins]` produces an empty plugins map. No errors.
- Existing `[channels.*]` and `[tools.*]` sections are unaffected.
- The `PluginConfigRegistry` is a new class; no existing APIs change.
- Core config types (`NachosConfig`, `CONFIG_SHAPE`) are not modified in the
  initial implementation. Integration is a separate step.

## File Layout

```
packages/shared/config/src/
  plugin-config.ts        # PluginConfigSchema, PluginConfigRegistry, validation
  plugin-config.test.ts   # Comprehensive test suite
  index.ts                # Updated exports (additive only)
```

## Testing Strategy

Tests cover:

1. **Schema registration** -- valid schemas accepted, invalid schemas rejected.
2. **Required field validation** -- missing required fields produce errors.
3. **Type validation** -- wrong types produce errors for all supported types.
4. **Default values** -- missing optional fields receive declared defaults.
5. **Unknown field rejection** -- extra keys produce errors.
6. **Enum validation** -- values outside the enum produce errors.
7. **Numeric bounds** -- values outside min/max produce errors.
8. **String length** -- values outside minLength/maxLength produce errors.
9. **Array validation** -- array items validated against `items` schema.
10. **Nested object validation** -- recursive property validation.
11. **Plugin ID validation** -- invalid IDs rejected.
12. **Duplicate registration** -- second registration for same ID is rejected.
13. **Validation of unregistered plugin** -- produces clear error.

## Future Extensions

- **Schema versioning** -- plugins declare schema version; migration helpers
  assist users when upgrading.
- **Config hot-reload** -- plugins can subscribe to config change events using
  the existing `HotReloadWatcher` infrastructure.
- **Config UI** -- the Admin UI can render config forms from plugin schemas.
- **Registry discovery** -- when the module registry (Phase 9) ships, it can
  fetch plugin schemas from the registry for pre-validation.
