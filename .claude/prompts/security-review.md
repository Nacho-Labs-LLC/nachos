# Security Review

Review code changes for security implications following Nachos' security-first design principles.

## Security-First Principles

1. **Deny by default**: All capabilities must be explicitly granted
2. **Least privilege**: Containers run non-root, minimal permissions
3. **Network isolation**: Components only access required networks
4. **Policy as code**: All security rules defined in policies
5. **Audit everything**: Security-relevant actions are logged

## Review Checklist

### Input Validation

- [ ] **All external input is validated** using TypeBox schemas
- [ ] **User input is sanitized** before processing
- [ ] **File paths are validated** and restricted to allowed directories
- [ ] **URLs are validated** and restricted to allowed domains
- [ ] **Command injection is prevented** (no unescaped user input in shell commands)
- [ ] **SQL injection is prevented** (using parameterized queries)
- [ ] **XSS is prevented** (proper escaping in outputs)

### Authentication & Authorization

- [ ] **Policy checks are enforced** for all operations
- [ ] **Session validation** is performed
- [ ] **User attribution** is maintained for audit trail
- [ ] **Rate limiting** is applied to prevent abuse
- [ ] **DLP scanning** is performed on sensitive operations

### Data Protection

- [ ] **Secrets are never logged** or exposed in responses
- [ ] **Environment variables** are used for sensitive configuration
- [ ] **Sensitive data is redacted** in logs and audit trails
- [ ] **File permissions** are restrictive (not world-readable)
- [ ] **Encryption** is used for sensitive data at rest (if applicable)

### Network Security

- [ ] **Network access is minimal** (only required networks)
- [ ] **TLS/HTTPS** is used for external communications
- [ ] **Internal network** is isolated from external access
- [ ] **Egress filtering** is applied (only allowed domains)
- [ ] **No hardcoded credentials** or API keys

### Container Security

- [ ] **Base image is minimal** (Alpine when possible)
- [ ] **Container runs as non-root** user
- [ ] **Filesystem is read-only** where possible
- [ ] **Capabilities are dropped** (cap_drop: ALL)
- [ ] **Security options** are set (no-new-privileges)
- [ ] **Health checks** are implemented
- [ ] **Resource limits** are defined (memory, CPU)

### Error Handling

- [ ] **Errors don't leak sensitive info** (stack traces, paths, credentials)
- [ ] **Error messages are user-friendly** but not revealing
- [ ] **Failures are logged** with appropriate context
- [ ] **Graceful degradation** is implemented
- [ ] **Timeouts are enforced** to prevent resource exhaustion

### Audit Logging

- [ ] **Security events are logged** with full context
- [ ] **Audit logs include attribution** (user, session, timestamp)
- [ ] **Audit logs are tamper-evident** (append-only, signed)
- [ ] **Sensitive data is redacted** in audit logs
- [ ] **Log retention** is configured appropriately

### Dependencies

- [ ] **Dependencies are minimal** (only what's needed)
- [ ] **Dependencies are up-to-date** (no known vulnerabilities)
- [ ] **Dependency licenses** are compatible
- [ ] **Lock files are committed** (pnpm-lock.yaml)
- [ ] **Supply chain** is verified (checksums, signatures)

## Common Vulnerabilities to Check

### 1. Command Injection

❌ **Bad:**
```typescript
exec(`git clone ${userProvidedUrl}`)
```

✅ **Good:**
```typescript
import { execFile } from 'child_process';
execFile('git', ['clone', userProvidedUrl])
```

### 2. Path Traversal

❌ **Bad:**
```typescript
readFile(`/app/data/${userPath}`)
```

✅ **Good:**
```typescript
import { resolve, normalize } from 'path';
const safePath = normalize(userPath).replace(/^(\.\.(\/|\\|$))+/, '');
const fullPath = resolve('/app/data', safePath);
if (!fullPath.startsWith('/app/data/')) {
  throw new Error('Invalid path');
}
readFile(fullPath)
```

### 3. Missing Input Validation

❌ **Bad:**
```typescript
async function createUser(data: any) {
  await db.insert(data);
}
```

✅ **Good:**
```typescript
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

const UserSchema = Type.Object({
  username: Type.String({ minLength: 3, maxLength: 20 }),
  email: Type.String({ format: 'email' })
});

async function createUser(data: unknown) {
  if (!Value.Check(UserSchema, data)) {
    throw new ValidationError('Invalid user data');
  }
  await db.insert(data);
}
```

### 4. Missing Policy Checks

❌ **Bad:**
```typescript
async function writeFile(path: string, content: string) {
  await fs.writeFile(path, content);
}
```

✅ **Good:**
```typescript
async function writeFile(
  path: string,
  content: string,
  context: RequestContext
) {
  const policy = await salsa.evaluate({
    operation: 'filesystem.write',
    resource: path,
    context
  });

  if (!policy.allowed) {
    throw new PolicyViolationError(policy.reason);
  }

  await audit.log({
    event: 'filesystem.write',
    resource: path,
    user: context.userId,
    outcome: 'allowed'
  });

  await fs.writeFile(path, content);
}
```

### 5. Exposed Secrets

❌ **Bad:**
```typescript
const API_KEY = 'sk-1234567890abcdef';
```

✅ **Good:**
```typescript
const API_KEY = process.env.API_KEY;
if (!API_KEY) {
  throw new Error('API_KEY environment variable is required');
}
```

### 6. Missing Rate Limiting

❌ **Bad:**
```typescript
app.post('/api/chat', async (req, res) => {
  const response = await llm.chat(req.body.message);
  res.json(response);
});
```

✅ **Good:**
```typescript
app.post('/api/chat', async (req, res) => {
  const rateLimit = await rateLimiter.check(req.user.id, 'chat');
  if (!rateLimit.allowed) {
    return res.status(429).json({
      error: 'Rate limit exceeded',
      retryAfter: rateLimit.retryAfter
    });
  }

  const response = await llm.chat(req.body.message);
  res.json(response);
});
```

## Security Testing

### Unit Tests

Test security controls:

```typescript
describe('Security Controls', () => {
  it('should reject invalid input', async () => {
    await expect(
      processInput({ malicious: 'data' })
    ).rejects.toThrow(ValidationError);
  });

  it('should enforce policy checks', async () => {
    await expect(
      writeFile('/etc/passwd', 'content', userContext)
    ).rejects.toThrow(PolicyViolationError);
  });

  it('should apply rate limiting', async () => {
    for (let i = 0; i < 10; i++) {
      await makeRequest();
    }
    await expect(makeRequest()).rejects.toThrow(RateLimitError);
  });
});
```

### Integration Tests

Test end-to-end security:

```typescript
describe('E2E Security', () => {
  it('should prevent unauthorized access', async () => {
    const response = await request(app)
      .post('/api/tool/execute')
      .send({ tool: 'filesystem', operation: 'read', path: '/etc/passwd' });

    expect(response.status).toBe(403);
  });
});
```

## Documentation

After security review, update:

- [ ] **README.md** - Document security considerations
- [ ] **manifest.json** - Declare all capabilities needed
- [ ] **policies/** - Add or update relevant policies
- [ ] **docs/security.md** - Document security features
- [ ] **ADR** - Create ADR if security architecture changes

## Security Review Summary Template

Use this template to document the review:

```markdown
## Security Review: [Feature/Change Name]

**Reviewer**: [Name]
**Date**: [YYYY-MM-DD]

### Changes Summary
[Brief description of changes]

### Security Considerations
- [Consideration 1]
- [Consideration 2]

### Findings
- ✅ [Safe practice found]
- ⚠️  [Potential issue, mitigated by...]
- ❌ [Issue that must be fixed]

### Recommendations
1. [Recommendation 1]
2. [Recommendation 2]

### Approval
- [ ] Changes follow security-first principles
- [ ] No unmitigated security risks identified
- [ ] Documentation updated
- [ ] Tests include security scenarios
```

## Resources

- [docs/security.md](../../../docs/security.md) - Security model
- [docs/adr/003-security-first-design.md](../../../docs/adr/003-security-first-design.md) - Security ADR
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)
