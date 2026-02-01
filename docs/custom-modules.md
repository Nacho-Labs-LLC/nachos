# Creating Custom Modules

**Status**: Draft - Coming Soon

Guide to creating custom channels, tools, and skills for Nachos.

## Contents

- [Module Types](#module-types)
- [Creating a Custom Channel](#creating-a-custom-channel)
- [Creating a Custom Tool](#creating-a-custom-tool)
- [Creating a Custom Skill](#creating-a-custom-skill)
- [Module Manifest](#module-manifest)
- [Testing Your Module](#testing-your-module)
- [Publishing](#publishing)

## Module Types

Nachos supports three types of custom modules:

1. **Channels** - Platform adapters (Slack, Discord, etc.)
2. **Tools** - Capabilities (browser, filesystem, etc.)
3. **Skills** - Bundled prompts + tools for specific tasks

## Creating a Custom Channel

_Coming soon - step-by-step channel creation guide_

See [Channel Interface API](./api/channel-interface.md) for the interface specification.

Quick start:

```bash
nachos create channel my-channel
cd packages/channels/my-channel
pnpm install
pnpm build
```

## Creating a Custom Tool

_Coming soon - step-by-step tool creation guide_

See [Tool Interface API](./api/tool-interface.md) for the interface specification.

Quick start:

```bash
nachos create tool my-tool
cd packages/tools/my-tool
pnpm install
pnpm build
```

## Creating a Custom Skill

_Coming soon - skill creation guide_

Skills bundle together:
- System prompts
- Tool configurations
- Example conversations

## Module Manifest

Every module requires a `manifest.json`:

```json
{
  "name": "nachos-tool-my-tool",
  "version": "1.0.0",
  "type": "tool",
  "capabilities": {
    "network": {
      "egress": ["api.example.com"]
    },
    "secrets": ["API_KEY"]
  },
  "provides": {
    "tool": "my-tool",
    "securityTier": 1
  }
}
```

See [Module Manifest Specification](./TECHNICAL_SPEC.md#7-module-manifest-specification) for complete schema.

## Testing Your Module

_Coming soon - testing guide_

See [CONTRIBUTING.md](../CONTRIBUTING.md#testing) for testing guidelines.

## Publishing

_Coming soon - publishing guide_

Modules can be:
- Published to npm
- Shared via GitHub
- Included in the official registry

---

**Note**: Module creation tooling is under development. See [CONTRIBUTING.md](../CONTRIBUTING.md) for current development guidelines.
