# ADR-006: DLP Library as Separate Repository

**Status**: Accepted

**Date**: 2026-02-01

**Implemented**: 2026-02-06

**Deciders**: Nachos Core Team

**Context**: Data Loss Prevention (DLP) scanning implementation strategy

**Update (2026-02-06)**: Outbound DLP scanning removed to reduce latency; DLP now applies only to inbound messages and tool inputs/outputs.

---

## Context and Problem Statement

Nachos needs DLP (Data Loss Prevention) scanning to detect and handle sensitive data in messages:

- API keys and secrets
- Private keys and certificates
- Credentials (AWS, GCP, etc.)
- Personal data (SSN, credit cards)
- Custom patterns defined by users

We need to decide:

1. Build custom vs. use existing library
2. If custom, where does the code live?
3. What patterns to ship by default?

## Decision Drivers

- **Reusability**: DLP scanning is useful beyond Nachos
- **Maintenance**: Pattern libraries require ongoing updates
- **TypeScript-native**: Prefer native TS over wrappers
- **Performance**: Must be fast for real-time scanning
- **Accuracy**: Low false positives, high detection rate
- **Extensibility**: Users must be able to add custom patterns

## Considered Options

### Option 1: Use Existing Library (detect-secrets, gitleaks)

Wrap an existing tool like Yelp's `detect-secrets` or `gitleaks`.

**Pros:**

- Battle-tested patterns
- Active maintenance
- Community contributions
- Proven accuracy

**Cons:**

- `detect-secrets` is Python (need subprocess or port)
- `gitleaks` is Go (need subprocess)
- Subprocess overhead per scan
- Dependency on external runtime
- Can't customize behavior easily
- Harder to embed in browser/edge

### Option 2: Port Patterns to TypeScript

Create a TypeScript library using patterns from existing tools.

**Pros:**

- Native TypeScript, no subprocess
- Fast (pure JS regex)
- Customizable
- Works in any JS runtime (Node, browser, edge)
- Can be used standalone

**Cons:**

- Maintenance burden for patterns
- Need to track upstream pattern updates
- Initial development effort

### Option 3: Hybrid - TypeScript Library, Port Patterns

Build a TypeScript scanning library, seeded with patterns from `detect-secrets` and `gitleaks`, maintained as a separate open-source repo.

**Pros:**

- All benefits of native TypeScript
- Patterns from proven sources
- Separate repo = independent versioning
- Community can contribute patterns
- Usable outside Nachos
- Clear separation of concerns

**Cons:**

- Two repos to maintain
- Need to sync pattern updates occasionally
- Initial setup effort

## Decision Outcome

**Chosen option**: Option 3 - TypeScript Library in Separate Repository

### Rationale

1. **Reusability**: A standalone DLP library is valuable to the broader community, not just Nachos users.

2. **Clean separation**: DLP detection is a distinct concern from Nachos core functionality.

3. **TypeScript-native**: Avoids subprocess overhead and works in any JS environment.

4. **Pattern quality**: Starting with patterns from `detect-secrets` and `gitleaks` gives us proven detection rules.

5. **Maintenance**: Separate repo with its own release cycle allows independent updates.

---

## Implementation

### Repository Structure

**Repository**: `nachos-dlp` (published as `@nacho-labs/nachos-dlp`)

```
nachos-dlp/
├── src/
│   ├── index.ts           # Main exports
│   ├── scanner.ts         # Core scanner class
│   ├── patterns/
│   │   ├── index.ts       # Pattern registry
│   │   ├── types.ts       # Pattern type definitions
│   │   ├── aws.ts         # AWS credentials
│   │   ├── gcp.ts         # GCP credentials
│   │   ├── azure.ts       # Azure credentials
│   │   ├── api-keys.ts    # Generic API keys
│   │   ├── private-keys.ts # SSH, PGP, etc.
│   │   ├── tokens.ts      # JWT, OAuth, etc.
│   │   ├── pii.ts         # SSN, credit cards
│   │   └── custom.ts      # Custom pattern support
│   ├── validators/
│   │   ├── luhn.ts        # Credit card validation
│   │   ├── entropy.ts     # High-entropy string detection
│   │   └── checksum.ts    # API key checksum validation
│   └── utils/
│       ├── redact.ts      # Redaction utilities
│       └── report.ts      # Finding report formatting
├── patterns/
│   └── custom.yaml        # User-defined patterns template
├── tests/
│   ├── scanner.test.ts
│   ├── patterns/
│   │   └── *.test.ts
│   └── fixtures/
│       └── samples.ts     # Test cases (sanitized)
├── benchmarks/
│   └── scan.bench.ts
├── package.json
├── tsconfig.json
└── README.md
```

### Core API

```typescript
// src/index.ts

export { Scanner, ScannerConfig } from './scanner'
export { Finding, Severity, PatternMatch } from './types'
export { patterns, PatternDefinition } from './patterns'
export { redact, RedactOptions } from './utils/redact'

// src/types.ts

export interface Finding {
  patternId: string
  patternName: string
  severity: Severity
  match: string
  redacted: string        // e.g., "sk-...XXXX"
  line?: number
  column?: number
  context?: string        // Surrounding text
  confidence: number      // 0-1, based on validators
}

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'

// src/scanner.ts

export interface ScannerConfig {
  patterns?: string[]           // Pattern IDs to enable (default: all)
  exclude?: string[]            // Pattern IDs to disable
  customPatterns?: PatternDefinition[]
  minConfidence?: number        // Filter low-confidence matches
  includeContext?: boolean      // Include surrounding text
  contextLines?: number         // Lines of context
}

export class Scanner {
  constructor(config?: ScannerConfig)

  /**
   * Scan text for sensitive data
   */
  scan(text: string): Finding[]

  /**
   * Scan with async validators (checksums, entropy)
   */
  scanAsync(text: string): Promise<Finding[]>

  /**
   * Add custom patterns at runtime
   */
  addPattern(pattern: PatternDefinition): void

  /**
   * Get all enabled patterns
   */
  getPatterns(): PatternDefinition[]
}
```

### Pattern Definition

```typescript
// src/patterns/types.ts

export interface PatternDefinition {
  id: string                    // Unique identifier
  name: string                  // Human-readable name
  description: string           // What this pattern detects
  severity: Severity
  pattern: RegExp | string      // Detection regex
  keywords?: string[]           // Fast pre-filter (e.g., ["aws", "secret"])
  validators?: Validator[]      // Additional validation
  falsePositives?: RegExp[]     // Known false positive patterns
  examples?: {
    positive: string[]          // Should match
    negative: string[]          // Should not match
  }
}

export type Validator =
  | { type: 'entropy'; min: number }
  | { type: 'luhn' }
  | { type: 'checksum'; algorithm: string }
  | { type: 'length'; min?: number; max?: number }
  | { type: 'custom'; fn: (match: string) => boolean }
```

### Built-in Patterns (Examples)

```typescript
// src/patterns/aws.ts

export const awsPatterns: PatternDefinition[] = [
  {
    id: 'aws-access-key-id',
    name: 'AWS Access Key ID',
    description: 'AWS access key identifier',
    severity: 'critical',
    pattern: /(?<![A-Z0-9])(A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}(?![A-Z0-9])/,
    keywords: ['AKIA', 'ASIA', 'aws'],
    validators: [
      { type: 'length', min: 20, max: 20 }
    ],
    examples: {
      positive: ['AKIAIOSFODNN7EXAMPLE'],
      negative: ['AKIAIOSFODNN7EXAMPL']  // Too short
    }
  },
  {
    id: 'aws-secret-access-key',
    name: 'AWS Secret Access Key',
    description: 'AWS secret access key',
    severity: 'critical',
    pattern: /(?<![A-Za-z0-9/+=])[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])/,
    keywords: ['aws', 'secret', 'key'],
    validators: [
      { type: 'entropy', min: 4.5 },
      { type: 'length', min: 40, max: 40 }
    ]
  }
]

// src/patterns/api-keys.ts

export const apiKeyPatterns: PatternDefinition[] = [
  {
    id: 'openai-api-key',
    name: 'OpenAI API Key',
    description: 'OpenAI API key',
    severity: 'critical',
    pattern: /sk-[a-zA-Z0-9]{20}T3BlbkFJ[a-zA-Z0-9]{20}/,
    keywords: ['sk-', 'openai'],
  },
  {
    id: 'anthropic-api-key',
    name: 'Anthropic API Key',
    description: 'Anthropic/Claude API key',
    severity: 'critical',
    pattern: /sk-ant-api[a-zA-Z0-9-_]{90,}/,
    keywords: ['sk-ant', 'anthropic', 'claude'],
  },
  {
    id: 'github-token',
    name: 'GitHub Token',
    description: 'GitHub personal access token or app token',
    severity: 'critical',
    pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/,
    keywords: ['ghp_', 'gho_', 'github'],
  },
  {
    id: 'generic-api-key',
    name: 'Generic API Key',
    description: 'Generic API key pattern',
    severity: 'medium',
    pattern: /(?:api[_-]?key|apikey|api[_-]?secret)['":\s]*[=:]\s*['"]?([a-zA-Z0-9_-]{20,})['"]?/i,
    keywords: ['api_key', 'apikey', 'api-key'],
    validators: [
      { type: 'entropy', min: 3.5 }
    ]
  }
]

// src/patterns/private-keys.ts

export const privateKeyPatterns: PatternDefinition[] = [
  {
    id: 'rsa-private-key',
    name: 'RSA Private Key',
    description: 'RSA private key in PEM format',
    severity: 'critical',
    pattern: /-----BEGIN RSA PRIVATE KEY-----[\s\S]*?-----END RSA PRIVATE KEY-----/,
    keywords: ['BEGIN RSA PRIVATE KEY'],
  },
  {
    id: 'openssh-private-key',
    name: 'OpenSSH Private Key',
    description: 'OpenSSH private key',
    severity: 'critical',
    pattern: /-----BEGIN OPENSSH PRIVATE KEY-----[\s\S]*?-----END OPENSSH PRIVATE KEY-----/,
    keywords: ['BEGIN OPENSSH PRIVATE KEY'],
  }
]
```

### Usage in Nachos

```typescript
// packages/core/gateway/src/salsa/dlp/scanner.ts

import { Scanner, Finding, redact } from '@nacho-labs/nachos-dlp'

export class DLPScanner {
  private scanner: Scanner
  private action: 'block' | 'redact' | 'alert'

  constructor(config: DLPConfig) {
    this.scanner = new Scanner({
      customPatterns: config.customPatterns,
      exclude: config.disabledPatterns,
    })
    this.action = config.action
  }

  async scan(content: string): Promise<DLPResult> {
    const findings = this.scanner.scan(content)

    if (findings.length === 0) {
      return { clean: true }
    }

    // Apply action based on security mode
    switch (this.action) {
      case 'block':
        return {
          clean: false,
          blocked: true,
          findings,
          message: 'Message blocked: contains sensitive data'
        }

      case 'redact':
        const redacted = this.redactContent(content, findings)
        return {
          clean: false,
          blocked: false,
          redactedContent: redacted,
          findings,
        }

      case 'alert':
        return {
          clean: false,
          blocked: false,
          findings,
          // Content passes through unchanged
        }
    }
  }

  private redactContent(content: string, findings: Finding[]): string {
    return redact(content, findings, { replacement: '[REDACTED]' })
  }
}
```

### Configuration in Nachos

```toml
[security.dlp]
enabled = true
action = "redact"  # block | redact | alert

# Disable specific patterns
disabled_patterns = ["generic-api-key"]

# Custom patterns file
custom_patterns_path = "./policies/dlp-patterns.yaml"
```

Custom patterns YAML:

```yaml
# policies/dlp-patterns.yaml

patterns:
  - id: internal-api-key
    name: Internal API Key
    description: Our internal service API keys
    severity: critical
    pattern: "int_[a-f0-9]{32}"
    keywords: ["int_"]

  - id: employee-id
    name: Employee ID
    description: Employee identification numbers
    severity: medium
    pattern: "EMP[0-9]{6}"
    keywords: ["EMP"]
```

---

## Pattern Sources

Initial patterns will be sourced from:

1. **detect-secrets** (Yelp): https://github.com/Yelp/detect-secrets
   - AWS, Slack, Stripe, Twilio, etc.
   - Well-tested regex patterns

2. **gitleaks** (Zricethezav): https://github.com/zricethezav/gitleaks
   - Comprehensive provider coverage
   - Active maintenance

3. **SecretLint**: https://github.com/secretlint/secretlint
   - TypeScript-based patterns
   - Good reference implementation

Patterns will be adapted (not copied verbatim) to:
- Use TypeScript
- Add validators for accuracy
- Include test cases
- Document each pattern

---

## Consequences

**Positive:**

- Reusable library for broader community
- TypeScript-native, no subprocess overhead
- Fast scanning (pure regex)
- Extensible with custom patterns
- Independent versioning and releases
- Clear separation from Nachos core

**Negative:**

- Two repositories to maintain
- Need to track upstream pattern updates
- Initial development effort
- Potential pattern drift from sources

**Neutral:**

- Library can evolve independently
- Community can contribute patterns
- Version compatibility to manage

**Implementation Update (2026-02-06):**

- Outbound DLP scanning removed to reduce response latency
- DLP scanning applied to: inbound messages, tool inputs, tool outputs
- Outbound policy checks still enforced, but no DLP pattern matching
- Trade-off: Faster responses vs. potential sensitive data in LLM outputs

---

## Validation

Success metrics:

- Detection rate >95% on test corpus
- False positive rate <5%
- Scan performance >10MB/sec
- Pattern coverage for top 20 secret types
- npm package published and usable standalone

---

## References

- [detect-secrets (Yelp)](https://github.com/Yelp/detect-secrets)
- [gitleaks](https://github.com/zricethezav/gitleaks)
- [SecretLint](https://github.com/secretlint/secretlint)
- [ADR-004: Embedded Salsa](./004-embedded-salsa-shardable-gateway.md)
- [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
