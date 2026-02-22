# Discord Status Reactions

Real-time status feedback via emoji reactions during bot operations.

## Features

✅ **Implemented:**
- Status reaction controller with emoji management
- Debounced emoji changes (700ms) to avoid spam
- Automatic cleanup of previous emojis
- Terminal state handling (success/error with timed removal)
- Stall detection (soft 10s, hard 30s warnings)
- Tool-specific emoji selection (coding, web, generic)

## Emoji Meanings

| Emoji | Meaning | When It Appears |
|-------|---------|-----------------|
| 🧠 | Thinking/Reasoning | Extended thinking mode active |
| 🛠️ | Tool Use (Generic) | Generic tool execution |
| 💻 | Coding Tool | exec, write, read, edit, etc. |
| 🌐 | Web Tool | web_search, web_fetch, browser |
| ⏳ | Soft Stall (>10s) | Operation taking longer than expected |
| ⚠️ | Hard Stall (>30s) | Possible hang warning |
| ✅ | Success | Task completed (holds 1.5s) |
| ❌ | Error | Execution failed (holds 2.5s) |

## Usage

### Creating a Status Controller

```typescript
import { createDiscordStatusReactionController } from './status-reactions.js';

const controller = createDiscordStatusReactionController({
  enabled: true,
  channelId: 'channel-id-here',
  messageId: 'message-id-here',
  client: discordClient,
});

// During processing
controller.setPhase(DISCORD_STATUS_EMOJIS.THINKING);
controller.setPhase(resolveToolStatusEmoji('web_search'));

// On completion
await controller.setTerminal(DISCORD_STATUS_EMOJIS.DONE);

// On error
await controller.setTerminal(DISCORD_STATUS_EMOJIS.ERROR);

// Manual cleanup
await controller.finish();
```

### Tool Emoji Resolution

```typescript
import { resolveToolStatusEmoji } from './status-reactions.js';

// Returns appropriate emoji for tool
const emoji = resolveToolStatusEmoji('web_search'); // → 🌐
const emoji = resolveToolStatusEmoji('exec'); // → 💻
const emoji = resolveToolStatusEmoji('generic_tool'); // → 🛠️
```

## Integration Status

### ✅ Phase 1: Controller Implementation (COMPLETE)
- [x] Status reaction controller class
- [x] Emoji selection logic
- [x] Debouncing and timing
- [x] Stall detection
- [x] Terminal state handling

### 🚧 Phase 2: Gateway Integration (TODO)
The controller is ready, but needs integration with the Gateway/Router:

1. **Add status events to message bus:**
   ```typescript
   // New topics needed
   TOPICS.status = {
     thinking: (sessionId: string) => `nachos.status.${sessionId}.thinking`,
     tool: (sessionId: string) => `nachos.status.${sessionId}.tool`,
     done: (sessionId: string) => `nachos.status.${sessionId}.done`,
     error: (sessionId: string) => `nachos.status.${sessionId}.error`,
   };
   ```

2. **Gateway emits status events during LLM processing:**
   ```typescript
   // In gateway.ts during requestLLMResponse
   await this.router.publishStatus({
     sessionId,
     status: 'thinking',
     channelMessageId: triggeringMessageId,
   });
   
   // During tool execution
   await this.router.publishStatus({
     sessionId,
     status: 'tool',
     toolName: call.tool,
     channelMessageId,
   });
   ```

3. **Discord adapter subscribes to status events:**
   ```typescript
   // In discord adapter start()
   await this.config.bus.subscribe(
     TOPICS.status.thinking('*'),
     async (payload) => this.handleStatusEvent(payload)
   );
   ```

4. **Discord adapter creates and manages controllers:**
   ```typescript
   private statusControllers: Map<string, StatusReactionController> = new Map();
   
   private async handleStatusEvent(event: StatusEvent) {
     let controller = this.statusControllers.get(event.channelMessageId);
     if (!controller) {
       controller = createDiscordStatusReactionController({
         enabled: this.channelConfig?.statusEmojis?.enabled ?? false,
         channelId: event.channelId,
         messageId: event.channelMessageId,
         client: this.client,
       });
       this.statusControllers.set(event.channelMessageId, controller);
     }
     
     if (event.status === 'thinking') {
       await controller.setPhase(DISCORD_STATUS_EMOJIS.THINKING);
     } else if (event.status === 'tool') {
       await controller.setPhase(resolveToolStatusEmoji(event.toolName));
     } else if (event.status === 'done') {
       await controller.setTerminal(DISCORD_STATUS_EMOJIS.DONE);
       this.statusControllers.delete(event.channelMessageId);
     } else if (event.status === 'error') {
       await controller.setTerminal(DISCORD_STATUS_EMOJIS.ERROR);
       this.statusControllers.delete(event.channelMessageId);
     }
   }
   ```

## Configuration

Add to `nachos.toml`:

```toml
[channels.discord]
token = "${DISCORD_BOT_TOKEN}"

[channels.discord.status_emojis]
enabled = true  # Enable status reactions (default: false)
```

Or via environment variable:
```bash
DISCORD_STATUS_EMOJIS_ENABLED=true
```

## Testing

To test without full integration:

```typescript
// Manual test script
import { createDiscordStatusReactionController, DISCORD_STATUS_EMOJIS } from './status-reactions.js';
import { Client, GatewayIntentBits } from 'discord.js';

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

await client.login(process.env.DISCORD_BOT_TOKEN);

const controller = createDiscordStatusReactionController({
  enabled: true,
  channelId: 'YOUR_CHANNEL_ID',
  messageId: 'YOUR_MESSAGE_ID',
  client,
});

// Test sequence
await controller.setPhase(DISCORD_STATUS_EMOJIS.THINKING);
await new Promise(resolve => setTimeout(resolve, 2000));

await controller.setPhase(DISCORD_STATUS_EMOJIS.WEB);
await new Promise(resolve => setTimeout(resolve, 2000));

await controller.setTerminal(DISCORD_STATUS_EMOJIS.DONE);
```

## Known Limitations

1. **No streaming support yet:** Status reactions work best with non-streaming responses
2. **Session tracking needed:** Need to map inbound messages to outbound responses
3. **Error handling:** Needs graceful degradation if emoji reactions fail (permissions, rate limits)

## Future Enhancements

- [ ] Streaming status updates (progressive emoji changes)
- [ ] Custom emoji configuration
- [ ] Per-server emoji preferences
- [ ] Status reaction persistence across bot restarts
- [ ] Rate limit handling for high-frequency status changes
