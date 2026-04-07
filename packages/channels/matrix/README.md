# Matrix Channel Adapter

Matrix protocol integration for Nachos. Supports decentralized chat via the
Matrix network.

## Features

- ✅ Direct messages (DMs)
- ✅ Room messages (channels)
- ✅ Text message sending/receiving
- ✅ Markdown formatting support
- ✅ DM and group policy enforcement
- ✅ Mention extraction
- ⏳ Reactions (planned)
- ⏳ Message editing (planned)
- ⏳ E2E encryption (planned)

## Configuration

### 1. Create a Matrix Bot Account

You need a Matrix account for your bot. You can:

**Option A: Register on matrix.org**

```bash
# Use Element (https://app.element.io) to create an account
# Or use the Matrix register endpoint directly
```

**Option B: Self-host Synapse**

```bash
# Run your own Matrix homeserver
# Follow: https://element-hq.github.io/synapse/latest/setup/installation.html
```

### 2. Get an Access Token

Once you have a bot account, get an access token:

**Using Element:**

1. Log in to Element with your bot account
2. Settings → Help & About → Advanced → Access Token
3. Copy the token

**Using curl:**

```bash
curl -XPOST -d '{"type":"m.login.password", "user":"@bot:matrix.org", "password":"YOUR_PASSWORD"}' \
  "https://matrix.org/_matrix/client/r0/login"
```

Response will include `access_token`.

### 3. Add to Nachos Config

Add the Matrix channel to your `nachos.json`:

```json
{
  "channels": [
    {
      "id": "matrix",
      "enabled": true,
      "secrets": {
        "accessToken": "YOUR_ACCESS_TOKEN_HERE"
      },
      "config": {
        "homeserver": "https://matrix.org",
        "userId": "@your-bot:matrix.org",
        "deviceId": "NACHOS_BOT"
      },
      "dmPolicy": {
        "userAllowlist": ["@alice:matrix.org", "@bob:example.com"]
      },
      "groupPolicy": {
        "mentionGating": true,
        "roomIds": ["!roomId123:matrix.org"],
        "userAllowlist": ["@alice:matrix.org"]
      }
    }
  ]
}
```

### Configuration Options

| Field         | Type   | Required | Description                           |
| ------------- | ------ | -------- | ------------------------------------- |
| `homeserver`  | string | ✅       | Matrix homeserver URL                 |
| `userId`      | string | ✅       | Bot user ID (e.g., `@bot:matrix.org`) |
| `accessToken` | string | ✅       | Bot access token (put in secrets)     |
| `deviceId`    | string | ❌       | Optional device ID for the session    |
| `syncFilter`  | object | ❌       | Custom Matrix sync filter             |

### Policy Configuration

**DM Policy:**

- `userAllowlist`: Array of Matrix user IDs allowed to DM the bot
- `pairing`: Enable pairing flow for new users (future)

**Group Policy:**

- `mentionGating`: Require bot mention to respond in rooms
- `roomIds`: Allowlist of room IDs where bot can operate
- `userAllowlist`: Users allowed to interact in rooms

## Usage

### Inviting the Bot to a Room

1. In Element or another Matrix client, open the room
2. Click "Invite" → Enter your bot's user ID
3. The bot will automatically join and start listening

### Direct Messages

Send a DM to the bot's user ID (e.g., `@bot:matrix.org`)

### Mentions in Rooms

If `mentionGating` is enabled:

```
@bot:matrix.org help me with something
```

## Development

### Build

```bash
pnpm build
```

### Test

```bash
pnpm test
```

### Watch Mode

```bash
pnpm dev
```

## Troubleshoths

### Bot doesn't respond

1. **Check access token**: Ensure the token is valid

   ```bash
   curl -H "Authorization: Bearer YOUR_TOKEN" \
     "https://matrix.org/_matrix/client/r0/account/whoami"
   ```

2. **Check sync state**: Look for sync errors in logs

3. **Check allowlists**: Ensure your user ID is in the DM or group allowlist

4. **Check room membership**: Bot must be invited to rooms to receive messages

### Connection issues

- Verify `homeserver` URL is correct and accessible
- Check firewall rules if self-hosting
- Ensure `userId` matches the account that owns the access token

## Architecture

### Event Flow

**Inbound (Matrix → Nachos):**

```
Matrix Room Event
  → Timeline Event Handler
  → Policy Check (DM/Group)
  → Publish to TOPICS.channel.inbound('matrix')
  → Gateway processes message
```

**Outbound (Nachos → Matrix):**

```
Gateway publishes to TOPICS.channel.outbound('matrix')
  → Matrix adapter receives message
  → Convert to Matrix event format
  → Send via Matrix client SDK
```

### Sync Model

The adapter uses the Matrix Client-Server API's sync mechanism:

- Incremental sync with `since` tokens
- Timeline events for room messages
- Presence and typing indicators (future)

## Future Enhancements

### Short-term

- [ ] Reaction support (`m.reaction` events)
- [ ] Message editing (`m.replace` events)
- [ ] Typing indicators
- [ ] Read receipts

### Medium-term

- [ ] Rich message formatting (custom HTML)
- [ ] File attachments
- [ ] Image/video messages
- [ ] Thread support (MSC3440)

### Long-term

- [ ] E2E encryption (Olm/Megolm)
- [ ] Voice/video call integration
- [ ] Spaces support
- [ ] Federated room discovery

## Resources

- [Matrix Spec](https://spec.matrix.org/)
- [Matrix JS SDK](https://github.com/matrix-org/matrix-js-sdk)
- [Element Web](https://github.com/vector-im/element-web)
- [Synapse Homeserver](https://github.com/matrix-org/synapse)

## License

Same as Nachos framework.
