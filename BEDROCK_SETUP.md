# AWS Bedrock Setup Guide

Complete guide for using Nachos with AWS Bedrock (Amazon's managed Claude
access).

---

## Overview

AWS Bedrock provides managed access to Anthropic Claude models through AWS
infrastructure. This integration is ideal for:

- **Enterprise environments** that standardize on AWS
- **Compliance requirements** that mandate AWS security controls
- **Workloads already running in AWS** (EC2, ECS, Lambda)
- **Cost allocation** through AWS billing

---

## Prerequisites

### 1. AWS Account with Bedrock Access

- Active AWS account
- Bedrock service enabled in your region
- Model access granted (see [Enable Model Access](#enable-model-access))

### 2. Claude Models Enabled

Anthropic Claude models must be explicitly enabled in your AWS region:

1. Navigate to AWS Bedrock console → Model access
2. Request access to Claude models (approval is usually instant)
3. Wait for "Access granted" status

### 3. IAM Permissions

Your AWS credentials need `bedrock:InvokeModel` permission:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream"
      ],
      "Resource": ["arn:aws:bedrock:*::foundation-model/anthropic.claude-*"]
    }
  ]
}
```

---

## Configuration

### 1. AWS Credentials Setup

Bedrock adapter uses the AWS SDK default credential chain (in order):

1. **Environment variables** (recommended for development):

   ```bash
   export AWS_ACCESS_KEY_ID="AKIAIOSFODNN7EXAMPLE"
   export AWS_SECRET_ACCESS_KEY="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
   export AWS_REGION="us-east-1"  # or AWS_DEFAULT_REGION
   ```

2. **AWS credentials file** (recommended for production):

   ```
   # ~/.aws/credentials
   [default]
   aws_access_key_id = AKIAIOSFODNN7EXAMPLE
   aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY

   # ~/.aws/config
   [default]
   region = us-east-1
   ```

3. **IAM roles** (recommended for AWS environments):
   - EC2 instance profiles
   - ECS task roles
   - Lambda execution roles

4. **AWS SSO** (for development with organization accounts):
   ```bash
   aws sso login --profile my-profile
   export AWS_PROFILE=my-profile
   ```

### 2. Nachos Configuration

Update your `nachos.toml`:

```toml
[llm]
provider = "bedrock"
model = "anthropic.claude-3-5-sonnet-20241022-v2:0"
max_tokens = 4096

# Optional: Override default AWS region
# If not set, uses AWS_REGION or AWS_DEFAULT_REGION env var
# region = "us-west-2"

# Optional: Configure temperature
temperature = 0.7
```

### 3. Available Models

Current Anthropic models on Bedrock:

| Model ID                                    | Name                 | Context | Use Case                   |
| ------------------------------------------- | -------------------- | ------- | -------------------------- |
| `anthropic.claude-3-5-sonnet-20241022-v2:0` | Claude 3.5 Sonnet v2 | 200K    | Best balance (recommended) |
| `anthropic.claude-3-5-sonnet-20240620-v1:0` | Claude 3.5 Sonnet v1 | 200K    | Previous version           |
| `anthropic.claude-3-opus-20240229-v1:0`     | Claude 3 Opus        | 200K    | Most capable               |
| `anthropic.claude-3-sonnet-20240229-v1:0`   | Claude 3 Sonnet      | 200K    | Good balance               |
| `anthropic.claude-3-haiku-20240307-v1:0`    | Claude 3 Haiku       | 200K    | Fastest/cheapest           |

**Note**: Model IDs include version suffixes (`:0`) required by Bedrock.

### 4. Region Support

Claude models are available in these AWS regions:

- `us-east-1` (N. Virginia) — **Recommended** (most models)
- `us-west-2` (Oregon)
- `eu-central-1` (Frankfurt)
- `eu-west-1` (Ireland)
- `ap-northeast-1` (Tokyo)
- `ap-southeast-1` (Singapore)

Check current availability:
[AWS Bedrock Regions](https://docs.aws.amazon.com/bedrock/latest/userguide/models-regions.html)

---

## Verification

### 1. Test Credentials

```bash
# Test AWS CLI access
aws bedrock list-foundation-models --region us-east-1 --by-provider anthropic

# Should return list of Claude models
```

### 2. Test Nachos Integration

```bash
# Start Nachos
nachos up

# Check logs for successful initialization
nachos logs gateway | grep -i bedrock

# Should see: "LLM proxy initialized: provider=bedrock model=anthropic.claude-3-5-sonnet-20241022-v2:0"
```

### 3. Send Test Message

```bash
# Via CLI (if Discord/Telegram configured)
# Or use admin web UI at http://localhost:3456
```

---

## Troubleshooting

### Error: "AccessDeniedException"

**Cause**: IAM permissions missing or insufficient

**Solution**:

1. Verify IAM policy includes `bedrock:InvokeModel`
2. Check resource ARN pattern matches Claude models
3. If using IAM role, verify instance profile attached

```bash
# Check current IAM identity
aws sts get-caller-identity

# Simulate policy (replace with your role ARN)
aws iam simulate-principal-policy \
  --policy-source-arn arn:aws:iam::ACCOUNT_ID:role/YOUR_ROLE \
  --action-names bedrock:InvokeModel \
  --resource-arns "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-5-sonnet-20241022-v2:0"
```

---

### Error: "ResourceNotFoundException"

**Cause**: Model not enabled in region or invalid model ID

**Solution**:

1. Navigate to AWS Bedrock console → Model access
2. Verify Claude models show "Access granted"
3. Check model ID matches exactly (including `:0` suffix)
4. Verify region in `nachos.toml` matches model availability

---

### Error: "ThrottlingException"

**Cause**: Too many requests, rate limit hit

**Solution**:

- Bedrock has per-model request quotas
- Reduce request frequency
- Consider upgrading service quota limits
- Implement retry with exponential backoff (adapter handles this automatically)

---

### Error: "ValidationException: Invalid request"

**Cause**: Request parameters don't match Bedrock API format

**Solutions**:

1. **Max tokens**: Bedrock requires `max_tokens`, check your config:

   ```toml
   [llm]
   max_tokens = 4096  # Must be set
   ```

2. **Tools format**: Bedrock expects `input_schema`, not `parameters`
   - Nachos adapter handles this conversion automatically
   - If you see this error, report it (adapter bug)

3. **Unsupported model**: Verify model ID is exactly correct
   ```bash
   # List available models
   aws bedrock list-foundation-models --region us-east-1 --by-provider anthropic
   ```

---

### Error: "No credentials found"

**Cause**: AWS SDK can't find credentials

**Solution**: Set credentials in order of preference:

1. **Temporary development**:

   ```bash
   export AWS_ACCESS_KEY_ID="..."
   export AWS_SECRET_ACCESS_KEY="..."
   export AWS_REGION="us-east-1"
   ```

2. **Persistent development**:

   ```bash
   aws configure
   # Enter access key, secret, region when prompted
   ```

3. **Production (EC2/ECS/Lambda)**:
   - Attach IAM role to compute resource
   - No credentials needed in config

---

### Debug Mode

Enable detailed AWS SDK logging:

```bash
# Set log level to debug
export AWS_LOG_LEVEL=debug

# Start Nachos
nachos up

# Watch for AWS SDK requests
nachos logs gateway | grep -i bedrock
```

---

## Cost Optimization

### 1. Choose Right Model

| Model  | Cost/1M Input Tokens | Cost/1M Output Tokens | Best For                  |
| ------ | -------------------- | --------------------- | ------------------------- |
| Haiku  | $0.25                | $1.25                 | High-volume, simple tasks |
| Sonnet | $3.00                | $15.00                | General use (recommended) |
| Opus   | $15.00               | $75.00                | Complex reasoning         |

### 2. Reduce Context Size

```toml
# In nachos.toml
[memory]
# Limit context window
max_messages = 20  # vs default 50
max_tokens = 50000  # vs default 100000
```

### 3. Enable Caching (Future)

Bedrock may support prompt caching in future. Monitor:

- [AWS Bedrock Updates](https://aws.amazon.com/bedrock/latest/)
- Nachos release notes for cache integration

---

## Security Best Practices

### 1. Use IAM Roles (Production)

**Never** embed AWS credentials in `nachos.toml` or environment variables in
production.

✅ **Correct** (EC2 example):

```bash
# Attach IAM role to instance with bedrock:InvokeModel permission
# No credentials in config
```

❌ **Incorrect**:

```toml
# NEVER DO THIS
[aws]
access_key_id = "AKIAIOSFODNN7EXAMPLE"
secret_access_key = "wJalrXUt..."
```

### 2. Least Privilege IAM Policy

Restrict to specific Claude models:

```json
{
  "Effect": "Allow",
  "Action": ["bedrock:InvokeModel"],
  "Resource": [
    "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-5-sonnet-20241022-v2:0"
  ]
}
```

### 3. Enable CloudTrail Logging

Monitor Bedrock API calls:

```bash
# Enable CloudTrail for Bedrock
aws cloudtrail create-trail --name bedrock-audit --s3-bucket-name my-audit-bucket
aws cloudtrail start-logging --name bedrock-audit
```

### 4. VPC Endpoints (Optional)

For private network access:

```bash
# Create Bedrock VPC endpoint
aws ec2 create-vpc-endpoint \
  --vpc-id vpc-xxx \
  --service-name com.amazonaws.us-east-1.bedrock-runtime \
  --subnet-ids subnet-xxx \
  --security-group-ids sg-xxx
```

---

## Migration from Direct Anthropic API

### Minimal Config Changes

**Before** (Anthropic direct):

```toml
[llm]
provider = "anthropic"
model = "claude-3-5-sonnet-20241022"
api_key = "${ANTHROPIC_API_KEY}"
```

**After** (Bedrock):

```toml
[llm]
provider = "bedrock"
model = "anthropic.claude-3-5-sonnet-20241022-v2:0"  # Add version suffix
# api_key not needed - uses AWS credentials
```

### Behavioral Differences

1. **Model IDs**: Bedrock adds vendor prefix and version suffix
   - Direct: `claude-3-5-sonnet-20241022`
   - Bedrock: `anthropic.claude-3-5-sonnet-20241022-v2:0`

2. **Rate Limits**: Different from Anthropic direct API
   - Check: AWS Service Quotas console
   - Default: 100 requests/minute per model

3. **Latency**: Slightly higher due to AWS infrastructure
   - Typical: +50-100ms vs direct API
   - Trade-off for compliance/cost benefits

4. **Tool Calling**: Identical format (adapter handles conversion)

---

## Advanced Configuration

### Custom Credentials Provider

```typescript
// Custom adapter initialization (for advanced use cases)
import { createBedrockAdapter } from '@nachos/llm-proxy/adapters/bedrock';

const adapter = createBedrockAdapter('us-west-2', {
  accessKeyId: 'AKIAIO...',
  secretAccessKey: 'wJalr...',
  sessionToken: 'FwoGZXIv...', // Optional for temporary credentials
});
```

### Multiple Regions (Failover)

Not directly supported yet. Feature request:
https://github.com/Nacho-Labs-LLC/nachos/issues

**Workaround**: Run multiple Nachos instances with different regions, use load
balancer.

---

## Support

### Documentation

- [Nachos GitHub](https://github.com/Nacho-Labs-LLC/nachos)
- [AWS Bedrock Docs](https://docs.aws.amazon.com/bedrock/)
- [Anthropic Claude on Bedrock](https://docs.anthropic.com/en/api/claude-on-amazon-bedrock)

### Common Questions

**Q: Can I use Bedrock with non-AWS infrastructure?**  
A: Yes! Bedrock is just an HTTP API. Works from anywhere with AWS credentials.

**Q: Does Bedrock support streaming?**  
A: Yes, fully supported by the Nachos adapter.

**Q: Can I use AWS Organizations for billing?**  
A: Yes, Bedrock costs roll up to consolidated billing.

**Q: What about data residency requirements?**  
A: Choose appropriate AWS region. Bedrock keeps data within region boundaries.

---

## Changelog

- **2026-02-24**: Initial Bedrock support (PR #112)
  - Added bedrock adapter
  - Streaming support
  - Tool calling compatibility
  - Comprehensive error handling

---

**Need help?** Open an issue: https://github.com/Nacho-Labs-LLC/nachos/issues
