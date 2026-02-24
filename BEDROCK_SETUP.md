# AWS Bedrock Support for Nachos

This guide explains how to configure Nachos to use AWS Bedrock as an LLM provider, enabling you to use Claude models through AWS infrastructure.

## Overview

AWS Bedrock provides access to Claude models through AWS's infrastructure with enterprise-grade security and compliance. This integration allows you to:

- Use Claude models via AWS Bedrock
- Leverage AWS IAM for authentication
- Utilize AWS regional endpoints
- Take advantage of AWS's enterprise SLAs and support

## Prerequisites

1. **AWS Account** with Bedrock access enabled
2. **Claude Model Access** - Request access to Anthropic models in AWS Bedrock:
   - Go to AWS Console → Bedrock → Model Access
   - Request access to desired Claude models
   - Note: Model availability varies by region

3. **AWS Credentials** configured via one of:
   - AWS CLI (`aws configure`)
   - Environment variables (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`)
   - IAM role (for EC2/ECS deployments)
   - AWS credentials file (`~/.aws/credentials`)

## Configuration

### 1. Set AWS Region

Configure the AWS region where you want to use Bedrock:

```bash
export AWS_REGION=us-east-1  # or your preferred region
```

Or in your `.env` file:

```env
AWS_REGION=us-east-1
AWS_DEFAULT_REGION=us-east-1
```

### 2. Configure Nachos

Update your `nachos.toml` to use Bedrock as the provider:

```toml
[llm]
provider = "bedrock"
model = "anthropic.claude-3-5-sonnet-20241022-v2:0"
max_tokens = 4096
temperature = 1.0
```

### 3. Available Claude Models

Common Claude model IDs on Bedrock:

```
anthropic.claude-3-5-sonnet-20241022-v2:0
anthropic.claude-3-5-sonnet-20240620-v1:0
anthropic.claude-3-5-haiku-20241022-v1:0
anthropic.claude-3-opus-20240229-v1:0
anthropic.claude-3-sonnet-20240229-v1:0
anthropic.claude-3-haiku-20240307-v1:0
```

**Note:** Model IDs follow the format: `anthropic.{model-name}-{version}`

Check the [AWS Bedrock documentation](https://docs.aws.amazon.com/bedrock/latest/userguide/models-supported.html) for the latest available models in your region.

## AWS Credentials Setup

### Option 1: AWS CLI Configuration

```bash
aws configure
# Enter your AWS Access Key ID
# Enter your AWS Secret Access Key
# Enter your default region (e.g., us-east-1)
# Enter output format (json)
```

### Option 2: Environment Variables

```bash
export AWS_ACCESS_KEY_ID="your-access-key"
export AWS_SECRET_ACCESS_KEY="your-secret-key"
export AWS_REGION="us-east-1"
```

### Option 3: IAM Role (Recommended for Production)

When running on AWS infrastructure (EC2, ECS, Lambda), use IAM roles:

1. Create an IAM role with `bedrock:InvokeModel` permission
2. Attach the role to your compute resource
3. No explicit credentials needed - SDK uses instance metadata

Example IAM policy:

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
      "Resource": "arn:aws:bedrock:*:*:foundation-model/anthropic.claude-*"
    }
  ]
}
```

## Advanced Configuration

### Multiple Models with Fallback

```toml
[llm]
provider = "bedrock"
model = "anthropic.claude-3-5-sonnet-20241022-v2:0"
fallback_order = [
  "anthropic.claude-3-5-sonnet-20240620-v1:0",
  "anthropic.claude-3-5-haiku-20241022-v1:0"
]
```

### Custom Timeout

Bedrock supports up to 60 minutes for long-running requests:

```toml
[llm]
provider = "bedrock"
model = "anthropic.claude-3-5-sonnet-20241022-v2:0"
timeout_ms = 3600000  # 60 minutes
```

### Regional Configuration

For multi-region deployment, set region per environment:

```bash
# Development (us-east-1)
export AWS_REGION=us-east-1

# Production (eu-west-1)
export AWS_REGION=eu-west-1
```

## Testing Your Setup

1. **Test AWS Credentials:**

```bash
aws bedrock list-foundation-models --region us-east-1
```

2. **Test Bedrock Access:**

```bash
aws bedrock-runtime invoke-model \
  --model-id anthropic.claude-3-5-haiku-20241022-v1:0 \
  --region us-east-1 \
  --body '{"anthropic_version":"bedrock-2023-05-31","max_tokens":100,"messages":[{"role":"user","content":"Hello"}]}' \
  --output-format json \
  /tmp/response.json
```

3. **Start Nachos:**

```bash
cd /path/to/nachos
docker compose up -d
```

## Troubleshooting

### "Access Denied" Error

**Cause:** Model access not granted in Bedrock.

**Solution:**
1. Go to AWS Console → Bedrock → Model Access
2. Request access to Anthropic models
3. Wait for approval (usually instant for Claude models)

### "Throttling Exception"

**Cause:** Rate limits exceeded.

**Solution:**
- Reduce request frequency
- Request quota increase in AWS Service Quotas
- Use fallback models

### "Model Not Found"

**Cause:** Model not available in your region.

**Solution:**
- Check model availability: `aws bedrock list-foundation-models --region your-region`
- Switch to a region where the model is available
- Use an alternative model

### Credentials Not Found

**Cause:** AWS SDK cannot locate credentials.

**Solution:**
1. Verify credentials file: `cat ~/.aws/credentials`
2. Check environment variables: `env | grep AWS`
3. Test AWS CLI: `aws sts get-caller-identity`

## Cost Considerations

- Bedrock pricing is per-token, similar to direct Anthropic pricing
- Costs vary by region and model
- Monitor usage via AWS Cost Explorer
- Set up billing alerts in AWS Budgets
- Consider using Claude Haiku for cost optimization on simpler tasks

See [AWS Bedrock Pricing](https://aws.amazon.com/bedrock/pricing/) for current rates.

## Security Best Practices

1. **Use IAM roles** instead of access keys when possible
2. **Rotate credentials** regularly if using access keys
3. **Enable CloudTrail** logging for audit trails
4. **Use VPC endpoints** for private connectivity
5. **Apply least privilege** IAM policies
6. **Enable encryption** at rest and in transit
7. **Set up AWS Config** rules for compliance monitoring

## Comparison: Bedrock vs Direct Anthropic

| Feature | Bedrock | Direct Anthropic |
|---------|---------|------------------|
| Authentication | AWS IAM | API Keys |
| Billing | AWS bill | Anthropic billing |
| Compliance | AWS compliance frameworks | Anthropic compliance |
| Rate Limits | AWS quotas | Anthropic limits |
| Latency | Depends on region | Direct to Anthropic |
| Features | Slightly delayed rollout | Immediate access |
| Enterprise Support | AWS Support | Anthropic Support |

**Use Bedrock when:**
- Already using AWS infrastructure
- Need AWS compliance frameworks (HIPAA, FedRAMP, etc.)
- Want consolidated AWS billing
- Require AWS Enterprise Support

**Use Direct Anthropic when:**
- Want latest features immediately
- Not on AWS infrastructure
- Prefer simpler setup
- Need direct Anthropic support channels

## Migration from Direct Anthropic

Migrating from direct Anthropic to Bedrock:

1. **Update configuration:**
   ```toml
   [llm]
   provider = "bedrock"  # Changed from "anthropic"
   model = "anthropic.claude-3-5-sonnet-20241022-v2:0"  # Updated model ID format
   ```

2. **Set up AWS credentials** (see above)

3. **Update model IDs** to Bedrock format

4. **Test thoroughly** - API is nearly identical but confirm behavior

5. **Monitor costs** - pricing structure may differ slightly

## Resources

- [AWS Bedrock Documentation](https://docs.aws.amazon.com/bedrock/)
- [Anthropic on Bedrock](https://docs.anthropic.com/claude/docs/claude-on-amazon-bedrock)
- [AWS SDK for JavaScript](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/)
- [Bedrock Model IDs](https://docs.aws.amazon.com/bedrock/latest/userguide/model-ids.html)
- [Bedrock Pricing](https://aws.amazon.com/bedrock/pricing/)

## Support

For issues specific to:
- **Nachos Bedrock integration:** Open an issue in the Nachos repository
- **AWS Bedrock service:** Contact AWS Support
- **Claude model behavior:** See Anthropic documentation

---

**Need help?** Check the [Nachos documentation](./README.md) or open an issue.
