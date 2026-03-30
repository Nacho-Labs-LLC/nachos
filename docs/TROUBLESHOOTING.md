# Troubleshooting Guide

Common issues, error messages, and their solutions. If you can't find your issue here, check [GitHub Issues](https://github.com/Nacho-Labs-LLC/nachos/issues) or open a new one.

---

## Docker Issues

### Container fails to start

**Symptom:** `docker compose up` exits immediately or restarts in a loop.

**Check the logs:**
```bash
docker compose logs gateway
docker compose logs -f gateway  # follow mode
```

**Common causes:**
- Missing `.env` file → copy `.env.example` to `.env` and set your API key
- Port already in use → change `ports` in `docker-compose.yml` or stop the conflicting process
- Invalid `nachos.toml` → check config syntax (see [Configuration errors](#configuration-errors) below)

---

### "Permission denied" on data directory

**Symptom:** Gateway fails with `EACCES` or `permission denied` for `/app/data` or a custom path.

**Fix:**
```bash
# Ensure the host directory exists and is writable
mkdir -p ./data
chmod 755 ./data
```

If using a custom `storage.path` in `nachos.toml`, make sure the path is mounted in `docker-compose.yml`:
```yaml
volumes:
  - ./your-data-dir:/app/your-data-dir
```

---

### Container builds but Discord/Telegram bot is offline

**Symptom:** Gateway starts, but the bot doesn't appear online in your channel.

**Check:**
1. Token is set correctly in `nachos.toml` (no extra quotes or whitespace)
2. Bot has been added to the server with correct permissions (Discord: `bot` scope + `Send Messages`, `Read Message History`)
3. Look for `[channel:discord] connected` in gateway logs — if missing, the token is wrong or the bot was kicked

---

## Configuration Errors

### "Unknown config key" at startup

**Symptom:** Gateway logs `Unknown config key: xyz` and may refuse to start.

**Cause:** A key in `nachos.toml` isn't recognized by the config validator.

**Fix:**
- Check [CONFIGURATION.md](CONFIGURATION.md) for the full supported key list
- Keys added in a newer version may not be in an older binary — pull the latest image
- Typos in nested key paths (e.g., `[assisant]` instead of `[assistant]`)

---

### "Config validation failed"

**Symptom:** Startup error mentioning validation failure with a list of specific fields.

**Common cases:**

| Error | Fix |
|---|---|
| `llm.provider is required` | Add `[llm]` section with `provider = "anthropic"` (or openai/bedrock) |
| `security.shell.timeout must be > 0` | Set `[security.shell] timeout = 30` (seconds) |
| `rate_limit.window_ms must be a positive integer` | Use integer milliseconds, e.g. `window_ms = 60000` |

---

### Bootstrap prompt file not found

**Symptom:** Warning at startup: `bootstrap_prompt file not found, falling back to inline value`

**Fix:** The `assistant.bootstrap_prompt` path is resolved relative to `nachos.toml`. Check:
```toml
[assistant]
bootstrap_prompt = "./prompts/my-prompt.md"  # must exist at this relative path
```

---

## Channel Connection Failures

### Discord: "Used disallowed intents"

**Symptom:** Bot connects then immediately disconnects with `[4014] Used disallowed intents`.

**Fix:** Enable **Message Content Intent** in the Discord Developer Portal:
1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Select your app → **Bot** tab
3. Enable **Message Content Intent** under Privileged Gateway Intents
4. Restart the gateway

---

### Discord: Bot responds to nothing

**Symptom:** Bot is online, no errors, but doesn't respond to messages.

**Check in order:**
1. `mention_gating: false` in your Discord channel config (if true, bot only responds when @mentioned)
2. Bot has `Read Message History` and `Send Messages` permissions in the channel
3. `servers` list in config — if set, the bot only listens on listed server/channel IDs
4. Check for `[channel:discord] message ignored` lines in gateway logs

---

### Telegram: "Webhook failed"

**Symptom:** Telegram bot not responding; logs show webhook errors.

**Fix:** Telegram webhooks require HTTPS. For local dev, use polling mode or a tunnel:
```toml
[channels.telegram]
token = "your-token"
# Polling works without HTTPS
```
For production, ensure your webhook URL is HTTPS with a valid cert.

---

## LLM / API Errors

### "Authentication failed" or 401 from LLM provider

**Symptom:** Gateway starts but all messages fail with auth error.

**Fix:**
- Verify API key in `.env` (no trailing whitespace or newlines)
- For Bedrock: check AWS credentials and region are set correctly
- For Ollama: confirm `base_url` points to the running instance (default `http://localhost:11434`)

---

### Responses are very slow or timing out

**Symptom:** Bot shows typing indicator for a long time, then fails or times out.

**Check:**
1. LLM provider latency — try the same request in your provider's playground
2. `runtime.timeout` in `nachos.toml` may be too low (default 60s)
3. Context window — very long conversation histories slow down responses; check `context_window` setting
4. If using tools, a tool call loop may be running; check gateway logs for tool call traces

---

### "Rate limit exceeded"

**Symptom:** Errors with 429 status or "rate limit" in message.

**Fix:**
- Gateway has built-in rate limiting config — check `[security.rate_limit]` in `nachos.toml`
- Provider-side rate limits: reduce request frequency or upgrade your API plan
- Check `[llm.cooldowns]` config — you can set per-provider cooldown windows

---

## CLI Issues

### `nachos migrate` not found

**Symptom:** `nachos migrate` returns "command not found" or "unknown command".

**Fix:** Ensure you're running the latest version. The `migrate` command was added in v0.x. Check:
```bash
nachos --version
nachos help
```

---

### `nachos setup` fails to write `.env`

**Symptom:** Setup completes but token isn't saved.

**Fix:** Run with the correct working directory (where you want `.env` created), or specify the path explicitly. The setup command writes to the current directory.

---

## Getting More Help

1. **Verbose logging:** Set `LOG_LEVEL=debug` in your `.env` for detailed output
2. **GitHub Issues:** [github.com/Nacho-Labs-LLC/nachos/issues](https://github.com/Nacho-Labs-LLC/nachos/issues)
3. **Check existing discussions** for similar error messages before opening a new issue

When opening an issue, include:
- Your `nachos.toml` (redact tokens)
- Gateway log output (last ~50 lines)
- Docker / OS version
- Nachos version (`nachos --version` or image tag)
