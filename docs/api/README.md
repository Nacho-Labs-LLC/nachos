# Nachos API Specifications

This directory contains API specifications for Nachos components.

## Overview

Nachos uses multiple communication patterns:

1. **Message Bus (NATS)**: Inter-component communication
2. **HTTP APIs**: Health checks, webhooks, and external interfaces
3. **TypeScript Interfaces**: Type-safe contracts between packages

## API Documentation

| API                                    | Type        | Purpose                    |
| -------------------------------------- | ----------- | -------------------------- |
| [Message Bus API](./message-bus.md)   | NATS        | Internal communication     |
| [Channel API](./channel-interface.md) | TypeScript  | Channel adapter contract   |
| [Tool API](./tool-interface.md)       | TypeScript  | Tool implementation        |
| [Policy API](./policy-api.md)         | NATS + HTTP | Security policy evaluation |
| [Gateway API](./gateway-api.md)       | Internal    | Session and routing        |
| [LLM Proxy API](./llm-proxy-api.md)   | Internal    | LLM provider abstraction   |

## Status Conventions

- **Draft**: Initial design, subject to change
- **Experimental**: Implemented but API may change
- **Stable**: API is stable, changes follow semver
- **Deprecated**: Scheduled for removal

## API Versioning

Nachos follows semantic versioning for API contracts:

- **Major**: Breaking changes to message schemas or interfaces
- **Minor**: New fields or optional parameters (backward compatible)
- **Patch**: Bug fixes, no API changes

Current API version: `1.0.0-alpha`

## Contributing

When proposing API changes:

1. Create an issue describing the change
2. Update the relevant API doc with proposed changes
3. Mark sections with `[PROPOSED]`
4. Get approval before implementing
5. Update status to Experimental when implemented
6. Promote to Stable after 2 minor releases without changes
