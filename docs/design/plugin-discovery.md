# Plugin Discovery System Design

**Status**: Proposed

**Date**: 2026-03-04

**Author**: System Architect

**Related ADRs**: ADR-001 (Docker-native), ADR-003 (Security-first), ADR-008
(Channel registry)

---

## 1. Problem Statement

Today, Nachos hardcodes knowledge of every channel and tool in three places:

1. **Compose generator** (`packages/cli/src/core/compose-generator.ts`) -- one
   `build*Service()` function per module, with hand-coded network assignments,
   environment variables, volume mounts, and health checks.
2. **Config schema** (`packages/shared/config/src/schema.ts`) -- explicit
   TypeScript interfaces for every channel and tool, plus the matching
   `CONFIG_SHAPE` in `validation.ts`.
3. **CLI add commands** (`packages/cli/src/commands/add/channel.ts` and
   `tool.ts`) -- hardcoded `VALID_CHANNELS` and `VALID_TOOLS` arrays that reject
   anything not on the list.

Adding a new channel or tool requires touching all three locations, plus
creating the container package, Dockerfile, and manifest. Third-party authors
cannot contribute modules without forking the monorepo.

This design describes a **plugin discovery system** that lets users register
external channels and tools from local directories or npm packages, and have
Nachos automatically integrate them into Docker Compose generation, config
validation, and the policy engine -- without modifying nachos-core source code.

## 2. Design Goals

- **Backward compatible**: Existing built-in channels and tools continue to work
  without any manifest changes.
- **No runtime discovery**: Consistent with ADR-008, all plugins are resolved at
  CLI time (`nachos up`), not at gateway runtime. Changes require a restart.
- **Security-first**: Plugin manifests declare capabilities. Unknown
  capabilities are rejected. Network and secret access is gated by the manifest.
- **Single-user scope**: No registry server, no package signing, no multi-tenant
  trust model. This is a local development and self-hosted deployment feature.
- **Docker-native**: Every plugin is ultimately a Docker container on the Nachos
  internal or egress network. The plugin manifest describes how to build or pull
  that container.

## 3. Plugin Manifest Format

### 3.1 File: `nachos-plugin.json`

Every plugin must contain a `nachos-plugin.json` at its root. This extends the
existing `manifest.json` format used by built-in channels and tools (see
`packages/channels/slack/manifest.json`,
`packages/tools/web-fetch/manifest.json`) with additional fields required for
external integration.

```jsonc
{
  // === Inherited from existing manifest.json ===
  "name": "nachos-channel-signal",
  "version": "1.0.0",
  "type": "channel", // "channel" | "tool"
  "capabilities": {
    "network": {
      "egress": ["signal.org"], // Domains this container needs to reach
    },
    "secrets": ["SIGNAL_PHONE_NUMBER", "SIGNAL_AUTH_TOKEN"],
    "volumes": [], // Optional host volume mounts
    "permissions": [], // Reserved for future capability grants
  },
  "provides": {
    "channel": "signal", // or "tool": "my_tool" for tool plugins
  },

  // === New plugin-specific fields ===
  "entry": {
    "dockerfile": "./Dockerfile", // Relative path to Dockerfile
    "context": ".", // Docker build context (relative)
  },

  "configSchema": {
    // JSON Schema for the plugin's config section
    "type": "object",
    "properties": {
      "enabled": { "type": "boolean", "default": false },
      "phone_number": {
        "type": "string",
        "description": "Signal phone number for the bot",
      },
      "trust_mode": {
        "type": "string",
        "enum": ["tofu", "strict"],
        "default": "tofu",
      },
    },
    "required": ["enabled"],
  },

  "configDefaults": {
    // Default values merged into nachos.toml
    "enabled": false,
    "trust_mode": "tofu",
  },

  "securityTier": 1, // 0=safe, 1=standard, 2=elevated, 3=restricted

  "dependencies": [], // Other plugin names required (e.g. ["nachos-tool-encryption"])

  "healthcheck": {
    // Optional: override container healthcheck
    "test": ["CMD", "node", "-e", "process.exit(0)"],
    "interval": "30s",
    "timeout": "3s",
    "retries": 3,
    "start_period": "10s",
  },

  "nachos": {
    "minVersion": "1.0", // Minimum Nachos version required
    "apiVersion": "1", // Plugin API version for forward compat
  },
}
```

### 3.2 Backward Compatibility with Existing Manifests

Built-in modules keep their current `manifest.json` files unchanged. The compose
generator continues to use its hardcoded `build*Service()` functions for
built-in modules. The plugin system only activates for **externally registered**
plugins.

Built-in modules can optionally migrate to `nachos-plugin.json` in a future
phase, but this is not required and not part of this design.

### 3.3 Plugin Manifest Validation Rules

The CLI validates `nachos-plugin.json` at registration time
(`nachos plugin add`) and again at compose generation time (`nachos up`).
Validation includes:

| Field                         | Rule                                                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------------------------- |
| `name`                        | Required. Must match `^[a-z0-9-]+$`. Max 64 characters.                                              |
| `version`                     | Required. Must be valid semver.                                                                      |
| `type`                        | Required. Must be `"channel"` or `"tool"`.                                                           |
| `capabilities.network.egress` | Optional. Must be array of strings. Each entry must be a valid domain or protocol (`http`, `https`). |
| `capabilities.secrets`        | Optional. Must be array of strings matching `^[A-Z_][A-Z0-9_]*$`.                                    |
| `entry.dockerfile`            | Required. Relative path. Must exist on disk at compose generation time.                              |
| `entry.context`               | Defaults to `"."`. Relative path. Must be a directory.                                               |
| `configSchema`                | Optional. Must be valid JSON Schema draft-07.                                                        |
| `securityTier`                | Optional. Defaults to 2 (elevated). Must be 0-3.                                                     |
| `dependencies`                | Optional. Array of plugin names. Circular dependencies are rejected.                                 |
| `nachos.minVersion`           | Optional. Checked against current Nachos version.                                                    |
| `nachos.apiVersion`           | Required if `nachos` is present. Must be `"1"`.                                                      |

### 3.4 Example: Channel Plugin

A Signal channel plugin in a local directory:

```
~/nachos-plugins/signal/
  nachos-plugin.json
  Dockerfile
  package.json
  src/
    index.ts
    main.ts
```

The `main.ts` follows the same pattern as built-in channels: it imports
`createChannelBus` from `@nachos/channel-base`, creates a class that implements
`ChannelAdapter` from `@nachos/types`, and connects to the NATS bus.

### 3.5 Example: Tool Plugin

A weather lookup tool:

```jsonc
{
  "name": "nachos-tool-weather",
  "version": "0.1.0",
  "type": "tool",
  "capabilities": {
    "network": {
      "egress": ["api.openweathermap.org"],
    },
    "secrets": ["OPENWEATHER_API_KEY"],
  },
  "provides": {
    "tool": "weather",
    "securityTier": 1,
  },
  "entry": {
    "dockerfile": "./Dockerfile",
    "context": ".",
  },
  "configSchema": {
    "type": "object",
    "properties": {
      "enabled": { "type": "boolean", "default": false },
      "units": {
        "type": "string",
        "enum": ["metric", "imperial"],
        "default": "metric",
      },
      "default_location": { "type": "string" },
    },
    "required": ["enabled"],
  },
  "configDefaults": {
    "enabled": false,
    "units": "metric",
  },
  "securityTier": 1,
  "nachos": {
    "minVersion": "1.0",
    "apiVersion": "1",
  },
}
```

## 4. Plugin Registry

### 4.1 Registry File: `nachos.toml` `[plugins]` Section

Plugins are registered in `nachos.toml` under a new `[plugins]` table. Each
entry maps a plugin name to its source location. This is the single source of
truth for what external plugins are active.

```toml
# nachos.toml

[plugins]
# Local directory plugins
[plugins.signal]
source = "path"
path = "../nachos-plugins/signal"

# npm package plugins
[plugins.weather]
source = "npm"
package = "nachos-tool-weather"
version = "^1.0.0"

# Pre-built Docker image plugins (no build step)
[plugins.custom-tool]
source = "image"
image = "ghcr.io/myorg/nachos-custom-tool:latest"
manifest = "./plugins/custom-tool/nachos-plugin.json"
```

### 4.2 Source Types

| Source  | Description                                                                                          | Resolution                                                                                                                                                                              |
| ------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `path`  | Local directory containing `nachos-plugin.json`                                                      | Reads manifest from `{path}/nachos-plugin.json`. Dockerfile is relative to that directory.                                                                                              |
| `npm`   | npm package that contains `nachos-plugin.json` at its root, or declares `"nachos"` in `package.json` | Runs `npm pack` or reads from `node_modules` after install. Extracts manifest.                                                                                                          |
| `image` | Pre-built Docker image. No build step.                                                               | Requires a local `manifest` path pointing to a `nachos-plugin.json` that describes the image. The `entry` field is ignored; the `image` field from the registry entry is used directly. |

### 4.3 npm Package Convention

npm packages can declare their Nachos plugin metadata in either of two ways:

**Option A**: Include `nachos-plugin.json` at the package root.

**Option B**: Add a `nachos` field to `package.json`:

```json
{
  "name": "nachos-tool-weather",
  "version": "1.0.0",
  "nachos": {
    "plugin": "./nachos-plugin.json"
  }
}
```

The `nachos.plugin` field points to the manifest relative to the package root.
If neither exists, registration fails with a clear error.

### 4.4 Plugin Configuration in `nachos.toml`

Once registered, a plugin's configuration appears under the appropriate section
(`channels` or `tools`) using the name from `provides.channel` or
`provides.tool`:

```toml
# Plugin registered as:
# [plugins.signal]
# source = "path"
# path = "../nachos-plugins/signal"

# Plugin configuration (auto-scaffolded by "nachos plugin add"):
[channels.signal]
enabled = true
phone_number = "+1234567890"
trust_mode = "tofu"
```

The config schema from `nachos-plugin.json` is used to validate this section.
Unknown keys under a plugin's config section are rejected, just as they are for
built-in modules.

### 4.5 Config Schema and Validation Integration

The existing `CONFIG_SHAPE` in `validation.ts` is extended at runtime. When
`loadAndValidateConfig()` is called, the config loader:

1. Reads `[plugins]` from `nachos.toml`.
2. For each registered plugin, reads its `nachos-plugin.json`.
3. Converts the plugin's `configSchema` into a `SchemaNode` entry and merges it
   into the appropriate section of `CONFIG_SHAPE` (`channels.*` or `tools.*`).
4. Runs the standard `validateNoUnknownKeys` check, which now includes
   plugin-contributed keys.

This means plugin config sections are validated against the plugin's own schema,
and unknown keys are still rejected.

## 5. Compose Integration

### 5.1 Plugin-Aware Compose Generation

The `generateComposeFile()` function in `compose-generator.ts` is extended with
a new phase after the built-in service generation:

```
1. Generate built-in core services (bus, redis, gateway, llm-proxy)
2. Generate built-in channels (slack, discord, etc.) -- existing code, unchanged
3. Generate built-in tools (filesystem, code-runner, etc.) -- existing code, unchanged
4. [NEW] Generate plugin services from [plugins] registry
```

For each registered plugin:

1. Read the plugin's `nachos-plugin.json`.
2. Check that the plugin is enabled in the corresponding config section (e.g.,
   `channels.signal.enabled`).
3. Build the Docker Compose service definition.

### 5.2 Service Definition Generation

A plugin service is generated with the following rules:

```typescript
interface PluginServiceConfig {
  container_name: string; // "nachos-{provides.channel|tool}"
  build?: {
    context: string; // Resolved absolute path from plugin source
    dockerfile: string; // entry.dockerfile, resolved relative to context
  };
  image?: string; // For "image" source type
  restart: string; // "unless-stopped"
  depends_on: Record<string, { condition: string }>; // Always depends on bus
  networks: string[]; // Derived from capabilities (see 5.3)
  ports?: string[]; // Only if capabilities.network.ports exists
  environment: Record<string, string>; // See 5.4
  volumes?: string[]; // From capabilities.volumes + standard mounts
  healthcheck?: object; // From manifest or default
  logging: object; // Standard nachos logging config
}
```

### 5.3 Network Assignment

Network assignment follows the existing pattern but is derived from the manifest
instead of being hardcoded:

| Condition                                        | Networks                               |
| ------------------------------------------------ | -------------------------------------- |
| `capabilities.network.egress` is empty or absent | `['nachos-internal']`                  |
| `capabilities.network.egress` has entries        | `['nachos-internal', 'nachos-egress']` |

This matches the existing behavior: channels with external API endpoints (Slack,
Discord, Telegram) get `nachos-egress`; tools that only talk to the bus
(filesystem, code-runner) get only `nachos-internal`.

### 5.4 Environment Variable Injection

Every plugin service receives these base environment variables:

```
NODE_ENV=development
NATS_URL=nats://bus:4222
LOG_LEVEL={runtime.log_level}
```

Plus, for each entry in `capabilities.secrets`, the compose generator checks
`process.env` and passes through matching values. This is the same pattern used
by built-in channels (e.g., `SLACK_BOT_TOKEN` in `buildSlackService`).

Additionally, all keys from the plugin's config section in `nachos.toml` are
converted to environment variables using the convention
`NACHOS_PLUGIN_{UPPER_KEY}`. For example, `trust_mode = "tofu"` becomes
`NACHOS_PLUGIN_TRUST_MODE=tofu`. This provides a uniform way for plugin
containers to read their configuration without needing filesystem access to
`nachos.toml`.

### 5.5 Volume Mounts

All plugin services receive the standard log volume:

```yaml
volumes:
  - nachos-logs:/var/log/nachos
```

Additional volumes from `capabilities.volumes` are mounted as specified. The
compose generator validates that volume paths do not escape the project root (no
`../` traversal outside the Nachos project directory).

Channel plugins additionally receive state directory mounts following the
built-in pattern:

```yaml
volumes:
  - ${projectRoot}/data/channels:/app/state
```

### 5.6 Port Assignment

If the plugin manifest declares `capabilities.network.ports`, those ports are
mapped. For channel plugins that need webhook endpoints, the port should be
declared in both the manifest and the plugin's config schema so the user can
override it.

To avoid port conflicts, the compose generator checks for duplicate host port
bindings across all services (built-in and plugin) and fails with a clear error
if a conflict is found.

## 6. CLI Commands

### 6.1 `nachos plugin add <source>`

Registers a plugin from a local path, npm package, or Docker image.

```
Usage:
  nachos plugin add <source> [options]

Arguments:
  source              Local path, npm package name, or docker image

Options:
  --source-type       Force source type: "path", "npm", or "image" (auto-detected if omitted)
  --name              Override plugin name (defaults to manifest name)
  --enable            Enable the plugin immediately (default: false)
  --json              Output JSON
  --dry-run           Show what would be added without writing

Examples:
  nachos plugin add ../my-signal-channel
  nachos plugin add nachos-tool-weather --source-type npm
  nachos plugin add ghcr.io/org/tool:v1 --source-type image --name custom-tool
```

**Behavior:**

1. Resolve the source to find `nachos-plugin.json`.
2. Validate the manifest (schema, capabilities, version constraints).
3. Check for name conflicts with built-in modules and existing plugins.
4. Add entry to `[plugins]` in `nachos.toml`.
5. Scaffold a config section under `[channels.*]` or `[tools.*]` using
   `configDefaults`.
6. If `--enable` is passed, set `enabled = true` in the config section.
7. Print next steps: required secrets, restart instructions.

**Auto-detection of source type:**

| Input                                                      | Detected Type |
| ---------------------------------------------------------- | ------------- |
| Starts with `.` or `/` or `~`, or is an existing directory | `path`        |
| Contains `:` and `/` (e.g., `ghcr.io/org/image:tag`)       | `image`       |
| Everything else                                            | `npm`         |

### 6.2 `nachos plugin remove <name>`

Removes a registered plugin.

```
Usage:
  nachos plugin remove <name> [options]

Options:
  --force             Skip confirmation prompt
  --keep-config       Remove the [plugins] entry but keep the channel/tool config
  --json              Output JSON
  --dry-run           Show what would be removed

Examples:
  nachos plugin remove signal
  nachos plugin remove weather --force
```

**Behavior:**

1. Look up the plugin in `[plugins]`.
2. Confirm removal (unless `--force`).
3. Remove the `[plugins.{name}]` entry from `nachos.toml`.
4. Unless `--keep-config`, also remove the corresponding `[channels.{name}]` or
   `[tools.{name}]` section.
5. Print restart instructions.

### 6.3 `nachos plugin list`

Lists all registered plugins with their status.

```
Usage:
  nachos plugin list [options]

Options:
  --json              Output JSON

Output:
  Plugins:
    signal       channel   path    enabled    ../nachos-plugins/signal
    weather      tool      npm     disabled   nachos-tool-weather@^1.0.0
```

**Behavior:**

1. Read `[plugins]` from `nachos.toml`.
2. For each plugin, resolve its manifest and check the corresponding config
   section for enabled state.
3. Display name, type, source kind, enabled status, and source location.

### 6.4 `nachos plugin inspect <name>`

Shows detailed information about a registered plugin.

```
Usage:
  nachos plugin inspect <name> [options]

Options:
  --json              Output JSON

Output:
  Plugin: signal
  Type: channel
  Version: 1.0.0
  Source: path (../nachos-plugins/signal)
  Security Tier: 1 (standard)
  Networks: nachos-internal, nachos-egress
  Secrets: SIGNAL_PHONE_NUMBER, SIGNAL_AUTH_TOKEN
  Dependencies: (none)
  Config Schema:
    phone_number: string (required)
    trust_mode: string [tofu, strict] (default: tofu)
  Status: enabled
```

### 6.5 Integration with Existing Commands

The existing commands are extended, not replaced:

| Command                             | Change                                                                                         |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| `nachos list`                       | Includes plugin-sourced modules alongside built-in modules, with a `(plugin)` badge            |
| `nachos up`                         | Generates compose services for enabled plugins after built-in services                         |
| `nachos add channel <name>`         | If `name` is not a built-in channel, suggests `nachos plugin add`                              |
| `nachos add tool <name>`            | If `name` is not a built-in tool, suggests `nachos plugin add`                                 |
| `nachos remove channel/tool <name>` | Works for plugin-sourced modules (removes config but warns to also run `nachos plugin remove`) |
| `nachos doctor`                     | Validates all registered plugins: manifest exists, Dockerfile exists, secrets available        |

## 7. Security Validation

### 7.1 Manifest Capability Validation

At registration and at compose generation, the following checks are performed:

**Known capabilities only.** The `capabilities` object may only contain keys
from the allowed set: `network`, `secrets`, `volumes`, `permissions`. Unknown
keys cause a validation error.

**Network egress validation.** Each entry in `capabilities.network.egress` must
be a valid domain name or one of the protocol keywords (`http`, `https`). IP
addresses and CIDR ranges are rejected. Wildcard domains (`*.example.com`) are
rejected.

**Secret name validation.** Each entry in `capabilities.secrets` must match
`^[A-Z_][A-Z0-9_]*$`. This prevents injection of malicious environment variable
names.

**Volume path validation.** Declared volumes must not:

- Reference the Docker socket (`/var/run/docker.sock`)
- Use `..` to escape the project root
- Mount system directories (`/etc`, `/proc`, `/sys`, `/dev`)

### 7.2 Security Tier Enforcement

The `securityTier` field determines how the plugin is treated by the policy
engine:

| Tier | Name       | Policy Behavior                                     |
| ---- | ---------- | --------------------------------------------------- |
| 0    | Safe       | Allowed in all security modes                       |
| 1    | Standard   | Allowed in standard and permissive modes            |
| 2    | Elevated   | Allowed in standard and permissive modes with audit |
| 3    | Restricted | Only allowed in permissive mode                     |

If a plugin declares `securityTier: 3` but the stack is running in standard
mode, the plugin's service is excluded from compose generation and a warning is
printed.

If a plugin does not declare a `securityTier`, it defaults to **2 (elevated)**.
This follows the deny-by-default principle: unknown plugins are treated as
potentially dangerous until the user explicitly sets a lower tier.

### 7.3 Policy Integration

When a plugin is enabled, the compose generator creates a corresponding policy
rule in the generated compose output. Tool plugins get a policy rule following
the same pattern as built-in tools in `policies/standard.yaml`:

```yaml
# Auto-generated for plugin: nachos-tool-weather
- id: 'plugin-tool-weather'
  description: 'Allow weather tool (plugin, SecurityTier: 1)'
  priority: 500 # Plugin rules get priority 500-599
  match:
    resource: 'tool'
    resourceId: 'weather'
    action: 'execute'
  effect: 'allow'
```

Plugin policy rules use a priority band of 500-599 to ensure they are evaluated
after built-in tool rules (priority 600+) but before the default-deny fallback.

Users can override plugin policy rules by adding their own rules in
`policies/*.yaml` with higher priorities.

### 7.4 Network Isolation

Plugins are isolated by the same network rules as built-in modules:

- A plugin with no `egress` entries joins only `nachos-internal` and cannot make
  external network requests.
- A plugin with `egress` entries joins both `nachos-internal` and
  `nachos-egress`. The egress network allows external traffic.
- There is no mechanism for a plugin to join arbitrary Docker networks.

### 7.5 Read-Only Filesystem

Plugin containers are generated with `read_only: true` in the compose file,
matching the security hardening applied to built-in containers. Writable tmpfs
mounts are added for `/tmp` and `/app/node_modules` as needed.

## 8. Resolution Pipeline

This section describes the complete flow from `nachos up` to a running plugin
container.

```
nachos up
  |
  v
1. loadAndValidateConfig()
  |-- Parse nachos.toml
  |-- Read [plugins] section
  |-- For each plugin:
  |     |-- Resolve source (path/npm/image)
  |     |-- Read nachos-plugin.json
  |     |-- Validate manifest
  |     |-- Merge configSchema into CONFIG_SHAPE
  |-- Validate full config (built-in + plugin schemas)
  |
  v
2. generateComposeFile()
  |-- Generate built-in services (unchanged)
  |-- For each enabled plugin:
  |     |-- Read nachos-plugin.json
  |     |-- Check security tier vs. security mode
  |     |-- Derive network assignment from capabilities
  |     |-- Build environment from secrets + config
  |     |-- Resolve Dockerfile path or image name
  |     |-- Check for port conflicts
  |     |-- Add service to compose file
  |
  v
3. writeComposeFile()
  |-- Write docker-compose.generated.yml
  |
  v
4. docker compose up
```

### 8.1 npm Source Resolution

For npm-sourced plugins, the resolution step:

1. Checks if the package exists in `node_modules` at the project root.
2. If not, runs `npm install --save-dev {package}@{version}` to install it.
3. Reads `nachos-plugin.json` from the installed package directory.
4. The Dockerfile `context` and `dockerfile` paths are resolved relative to the
   installed package location in `node_modules`.

This means npm plugins are installed as dev dependencies and their Docker build
context is inside `node_modules`. The Dockerfile must be self-contained (copy
source, install dependencies, etc.) and not rely on the monorepo workspace
structure.

### 8.2 Path Source Resolution

For path-sourced plugins:

1. Resolve the path relative to the `nachos.toml` location.
2. Read `nachos-plugin.json` from the resolved directory.
3. Dockerfile context is the resolved directory.

### 8.3 Image Source Resolution

For image-sourced plugins:

1. Read the manifest from the local `manifest` path specified in the registry
   entry.
2. Skip the build step entirely; use the `image` field from the registry entry.
3. The manifest is still required for capability validation, config schema, and
   policy generation.

## 9. Data Structures

### 9.1 Plugin Registry Entry (in-memory)

```typescript
interface PluginRegistryEntry {
  /** Name used in [plugins.{name}] */
  name: string;

  /** Resolved manifest */
  manifest: PluginManifest;

  /** Source type */
  sourceType: 'path' | 'npm' | 'image';

  /** Resolved absolute path to the plugin directory (path/npm) or manifest (image) */
  resolvedPath: string;

  /** For image source: the Docker image reference */
  image?: string;

  /** Whether the plugin is enabled in its config section */
  enabled: boolean;
}
```

### 9.2 Plugin Manifest (TypeScript type)

```typescript
interface PluginManifest {
  name: string;
  version: string;
  type: 'channel' | 'tool';

  capabilities: {
    network?: {
      egress?: string[];
      ports?: number[];
    };
    secrets?: string[];
    volumes?: string[];
    permissions?: string[];
  };

  provides: {
    channel?: string;
    tool?: string;
    securityTier?: number;
  };

  entry: {
    dockerfile: string;
    context: string;
  };

  configSchema?: Record<string, unknown>; // JSON Schema
  configDefaults?: Record<string, unknown>;
  securityTier?: number; // 0-3, default 2
  dependencies?: string[];
  healthcheck?: {
    test: string[];
    interval: string;
    timeout: string;
    retries: number;
    start_period?: string;
  };

  nachos?: {
    minVersion?: string;
    apiVersion: string;
  };
}
```

### 9.3 Config Schema Types (additions to schema.ts)

```typescript
/** Plugin source configuration in [plugins.*] */
interface PluginSourceConfig {
  source: 'path' | 'npm' | 'image';
  path?: string; // For source: "path"
  package?: string; // For source: "npm"
  version?: string; // For source: "npm"
  image?: string; // For source: "image"
  manifest?: string; // For source: "image" -- path to local manifest
}

/** Added to NachosConfig */
interface NachosConfig {
  // ... existing fields ...
  plugins?: Record<string, PluginSourceConfig>;
}
```

### 9.4 CONFIG_SHAPE Addition

```typescript
// Added to CONFIG_SHAPE in validation.ts
plugins: true,  // Dynamic validation handled by plugin schema merge
```

The `plugins` key uses `true` (leaf node) in CONFIG_SHAPE because its structure
is validated separately by the plugin resolver. The per-plugin config sections
under `channels.*` or `tools.*` are validated against the merged schema that
includes plugin-contributed keys.

## 10. Error Handling

Every error condition has a specific error code and actionable message:

| Condition                                | Error Code                    | Message                                                                                                                                             |
| ---------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nachos-plugin.json` not found at source | `PLUGIN_MANIFEST_NOT_FOUND`   | `No nachos-plugin.json found at {path}. Ensure the plugin directory contains a valid manifest.`                                                     |
| Manifest fails validation                | `PLUGIN_MANIFEST_INVALID`     | `Plugin manifest validation failed: {details}`                                                                                                      |
| Dockerfile not found                     | `PLUGIN_DOCKERFILE_NOT_FOUND` | `Dockerfile "{path}" not found. Check the entry.dockerfile field in nachos-plugin.json.`                                                            |
| Name conflicts with built-in             | `PLUGIN_NAME_CONFLICT`        | `Plugin name "{name}" conflicts with built-in {type}. Use a different name.`                                                                        |
| Duplicate plugin name                    | `PLUGIN_DUPLICATE`            | `Plugin "{name}" is already registered.`                                                                                                            |
| Security tier too high for mode          | `PLUGIN_SECURITY_TIER`        | `Plugin "{name}" requires security tier {tier} but stack is running in {mode} mode. Switch to permissive mode or lower the plugin's security tier.` |
| Port conflict                            | `PLUGIN_PORT_CONFLICT`        | `Port {port} is already used by service "{service}". Change the plugin's port configuration.`                                                       |
| Circular dependency                      | `PLUGIN_CIRCULAR_DEPENDENCY`  | `Circular plugin dependency detected: {chain}`                                                                                                      |
| Missing dependency                       | `PLUGIN_MISSING_DEPENDENCY`   | `Plugin "{name}" requires plugin "{dep}" which is not registered.`                                                                                  |
| npm install fails                        | `PLUGIN_NPM_INSTALL_FAILED`   | `Failed to install npm package "{package}": {error}`                                                                                                |
| Nachos version mismatch                  | `PLUGIN_VERSION_MISMATCH`     | `Plugin "{name}" requires Nachos >= {required} but current version is {current}.`                                                                   |

## 11. Migration Path

### 11.1 Phase 1: Plugin Infrastructure (this design)

- Add `[plugins]` section to config schema and validation.
- Implement plugin manifest loader and validator.
- Extend compose generator with plugin service generation.
- Implement `nachos plugin add|remove|list|inspect` commands.
- Extend `nachos doctor` to validate plugins.
- Update `nachos list` to show plugins.

### 11.2 Phase 2: Built-in Module Migration (future, optional)

- Add `nachos-plugin.json` files to built-in channels and tools.
- Refactor compose generator to use manifests for all modules, not just plugins.
- Remove hardcoded `build*Service()` functions.
- This is a large refactor and should only happen when the plugin system is
  proven stable.

### 11.3 Phase 3: Community Plugins (future)

- Plugin template generator: `nachos create plugin --type channel`
- Published plugin registry (static JSON file on GitHub, not a server)
- `nachos plugin search <query>` to browse the registry
- Suggested plugins in `nachos doctor` output

## 12. Trade-Off Analysis

### 12.1 Config-Driven vs. Auto-Discovery

**Decision**: Config-driven (explicit `[plugins]` registration).

**Rationale**: Auto-scanning directories or `node_modules` for plugins would
violate the principle of explicit configuration. A user should always know
exactly what plugins are active by reading `nachos.toml`. This also prevents
accidental activation of plugins and aligns with ADR-008's decision to use
config-driven registry with restart-to-reload.

### 12.2 JSON Schema vs. TypeScript Types for Plugin Config

**Decision**: JSON Schema in the manifest.

**Rationale**: Plugin authors may not use TypeScript. JSON Schema is
language-agnostic, can be validated at runtime without compilation, and is the
industry standard for configuration validation. The CLI converts JSON Schema to
`SchemaNode` entries for the existing validation pipeline.

### 12.3 Single Manifest File vs. Split Manifest/Config

**Decision**: Single `nachos-plugin.json` file.

**Rationale**: A single file is easier to author, validate, and distribute. The
config section in `nachos.toml` handles per-deployment configuration. The
manifest describes the plugin's identity and capabilities (which do not change
between deployments).

### 12.4 npm vs. OCI Registry for Distribution

**Decision**: Support npm packages initially, not OCI artifacts.

**Rationale**: Nachos is a Node.js project. npm is the natural distribution
channel. Authors `npm publish` their plugin, users `nachos plugin add <pkg>`.
OCI registry support (pulling plugin manifests from container registries) can be
added in Phase 3 if there is demand. The `image` source type provides a
workaround for users who prefer container registries -- they publish the image
separately and point the manifest to a local file.

### 12.5 Plugin Priority Band (500-599)

**Decision**: Plugins get a dedicated policy priority band below built-in tools.

**Rationale**: Built-in tool rules use priorities 600-850. Plugin rules at
500-599 ensure they are evaluated after built-in rules (which take precedence)
but before the default-deny. Users who want to restrict a plugin can add a
custom rule at priority 400-499. This provides a clean layering:

```
850+  Built-in channel/DM rules
600+  Built-in tool rules
500+  Plugin rules (auto-generated)
400+  User overrides for plugins
  1   Default deny
```

## 13. File Changes Summary

This section lists every file that would need to be created or modified to
implement this design. Only the design document is created now; no code changes
are included.

### New Files

| File                                          | Purpose                                             |
| --------------------------------------------- | --------------------------------------------------- |
| `packages/cli/src/core/plugin-resolver.ts`    | Resolves plugin sources, reads manifests, validates |
| `packages/cli/src/core/plugin-manifest.ts`    | Plugin manifest types and JSON Schema validator     |
| `packages/cli/src/commands/plugin/add.ts`     | `nachos plugin add` command                         |
| `packages/cli/src/commands/plugin/remove.ts`  | `nachos plugin remove` command                      |
| `packages/cli/src/commands/plugin/list.ts`    | `nachos plugin list` command                        |
| `packages/cli/src/commands/plugin/inspect.ts` | `nachos plugin inspect` command                     |

### Modified Files

| File                                         | Change                                                               |
| -------------------------------------------- | -------------------------------------------------------------------- |
| `packages/shared/config/src/schema.ts`       | Add `PluginSourceConfig` type, add `plugins?` to `NachosConfig`      |
| `packages/shared/config/src/validation.ts`   | Add `plugins: true` to `CONFIG_SHAPE`, add plugin schema merge logic |
| `packages/cli/src/core/compose-generator.ts` | Add `generatePluginServices()` after built-in service generation     |
| `packages/cli/src/commands/add/channel.ts`   | Suggest `nachos plugin add` for unknown channel names                |
| `packages/cli/src/commands/add/tool.ts`      | Suggest `nachos plugin add` for unknown tool names                   |
| `packages/cli/src/commands/list.ts`          | Include plugin-sourced modules with badge                            |
| `packages/cli/src/commands/doctor.ts`        | Add plugin validation checks                                         |
| `packages/cli/src/core/errors.ts`            | Add plugin-specific error classes                                    |
| `packages/cli/src/cli.ts`                    | Register `plugin` command group                                      |

### Not Modified

- Built-in `manifest.json` files -- unchanged, backward compatible.
- `policies/*.yaml` -- plugin policies are auto-generated, not hand-written.
- Gateway source code -- gateway discovers tools via NATS, not via the plugin
  system. Plugin tools register with the gateway the same way built-in tools do.
- Channel base library -- plugin channels use `@nachos/channel-base` and
  `@nachos/types` the same way built-in channels do.

## 14. Open Questions

These items require further discussion before implementation:

1. **Plugin versioning and updates.** When a user runs `nachos plugin add` for
   an already-registered npm plugin with a newer version, should it auto-update?
   Or require an explicit `nachos plugin update` command?

2. **Plugin lock file.** Should there be a `nachos-plugins.lock` file that pins
   exact resolved versions and paths, similar to `package-lock.json`? This would
   improve reproducibility but adds complexity.

3. **Hot reload for path plugins.** ADR-008 chose restart-to-reload. But for
   local development of plugins, a `--watch` flag on `nachos up` that rebuilds
   plugin containers on file change would be valuable. This is a developer
   experience enhancement, not a security concern, since it only applies in
   development.

4. **Gateway tool registration.** Tool plugins need to register their tool
   schemas with the gateway so the LLM knows about them. Currently, built-in
   tools do this via NATS subscription patterns. Plugin tools would follow the
   same pattern, but the gateway needs to know the tool's JSON Schema
   definition. Should this be embedded in `nachos-plugin.json` or loaded
   separately?
