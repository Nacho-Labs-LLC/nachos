<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, computed } from 'vue';
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
});

interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
}

interface StatusEvent {
  type: 'thinking' | 'tool' | 'done' | 'error' | 'connected';
  toolName?: string;
  error?: string;
}

const messages = ref<Message[]>([]);
const inputText = ref('');
const sessionId = ref<string | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const currentStatus = ref<StatusEvent | null>(null);
const messageContainer = ref<HTMLElement | null>(null);

let eventSource: EventSource | null = null;

const messageCount = computed(() => messages.value.length);

function renderMarkdown(text: string): string {
  return md.render(text);
}

async function sendMessage() {
  if (!inputText.value.trim() || loading.value) return;

  const userMessage = inputText.value.trim();
  inputText.value = '';
  loading.value = true;
  error.value = null;

  // Add user message immediately
  messages.value.push({
    id: crypto.randomUUID(),
    role: 'user',
    text: userMessage,
    timestamp: new Date().toISOString(),
  });

  await nextTick();
  scrollToBottom();

  try {
    const res = await fetch('/api/chat/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: userMessage,
        sessionId: sessionId.value,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(errText || res.statusText);
    }

    const data = await res.json();
    
    // Update session ID if this is the first message
    if (!sessionId.value && data.sessionId) {
      sessionId.value = data.sessionId;
      // Start SSE stream
      connectSSE();
    }
  } catch (err) {
    error.value = String(err);
    loading.value = false;
  }
}

function connectSSE() {
  if (!sessionId.value) return;

  if (eventSource) {
    eventSource.close();
  }

  const url = `/api/chat/stream?sessionId=${encodeURIComponent(sessionId.value)}`;
  eventSource = new EventSource(url);

  eventSource.addEventListener('message', (e) => {
    try {
      const data = JSON.parse(e.data);
      
      if (data.type === 'message') {
        // Add assistant message
        messages.value.push({
          id: crypto.randomUUID(),
          role: 'assistant',
          text: data.text,
          timestamp: data.timestamp,
        });
        loading.value = false;
        currentStatus.value = null;
        nextTick(() => scrollToBottom());
      }
    } catch (err) {
      console.error('[chat] Error parsing message:', err);
    }
  });

  eventSource.addEventListener('status', (e) => {
    try {
      const data = JSON.parse(e.data);
      
      if (data.type === 'connected') {
        console.log('[chat] Connected to SSE stream');
      } else if (data.type === 'thinking') {
        currentStatus.value = { type: 'thinking' };
      } else if (data.type === 'tool') {
        currentStatus.value = { type: 'tool', toolName: data.tool };
      } else if (data.type === 'done') {
        currentStatus.value = { type: 'done' };
        setTimeout(() => {
          currentStatus.value = null;
        }, 1000);
      } else if (data.type === 'error') {
        currentStatus.value = { type: 'error', error: data.error };
        error.value = data.error;
        loading.value = false;
      }
    } catch (err) {
      console.error('[chat] Error parsing status:', err);
    }
  });

  eventSource.addEventListener('error', (e) => {
    console.error('[chat] SSE error:', e);
    error.value = 'Connection lost. Please refresh the page.';
    loading.value = false;
  });
}

async function resetSession() {
  if (!confirm('Reset the chat session? This will clear all messages.')) return;

  try {
    if (sessionId.value) {
      await fetch('/api/chat/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sessionId.value }),
      });
    }

    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }

    messages.value = [];
    sessionId.value = null;
    currentStatus.value = null;
    loading.value = false;
    error.value = null;
  } catch (err) {
    error.value = String(err);
  }
}

function scrollToBottom() {
  if (messageContainer.value) {
    messageContainer.value.scrollTop = messageContainer.value.scrollHeight;
  }
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

onUnmounted(() => {
  if (eventSource) {
    eventSource.close();
  }
});
</script>

<template>
  <div class="page chat-page">
    <header class="page-header">
      <div>
        <h1 class="page-title">Web Chat</h1>
        <p class="page-sub">
          {{ sessionId ? `Session: ${sessionId.slice(0, 8)}…` : 'No active session' }}
          <span v-if="messageCount > 0"> · {{ messageCount }} messages</span>
        </p>
      </div>
      <div class="header-actions">
        <button 
          class="btn-ghost" 
          :disabled="!sessionId || loading" 
          @click="resetSession"
        >
          ⟳ Reset Session
        </button>
      </div>
    </header>

    <div v-if="error" class="alert-error">{{ error }}</div>

    <div class="chat-container">
      <!-- Messages -->
      <div ref="messageContainer" class="messages">
        <div v-if="messages.length === 0" class="empty-state">
          <p class="empty-icon">💬</p>
          <p class="empty-text">Send a message to start chatting</p>
        </div>

        <div
          v-for="msg in messages"
          :key="msg.id"
          class="message"
          :class="{ 'message-user': msg.role === 'user', 'message-assistant': msg.role === 'assistant' }"
        >
          <div class="message-header">
            <span class="message-role">{{ msg.role === 'user' ? 'You' : 'Assistant' }}</span>
            <span class="message-time">{{ formatTime(msg.timestamp) }}</span>
          </div>
          <div
            v-if="msg.role === 'assistant'"
            class="message-content markdown-content"
            v-html="renderMarkdown(msg.text)"
          ></div>
          <div v-else class="message-content">{{ msg.text }}</div>
        </div>

        <!-- Status indicator -->
        <div v-if="currentStatus" class="status-indicator">
          <span v-if="currentStatus.type === 'thinking'" class="status-text">
            <span class="spinner">⟳</span> Thinking...
          </span>
          <span v-else-if="currentStatus.type === 'tool'" class="status-text">
            <span class="spinner">⚙</span> Using tool{{ currentStatus.toolName ? `: ${currentStatus.toolName}` : '' }}...
          </span>
          <span v-else-if="currentStatus.type === 'done'" class="status-text">
            ✓ Done
          </span>
        </div>
      </div>

      <!-- Input -->
      <div class="input-container">
        <textarea
          v-model="inputText"
          class="chat-input"
          placeholder="Type a message... (Enter to send, Shift+Enter for new line)"
          rows="3"
          :disabled="loading"
          @keydown="handleKeydown"
        ></textarea>
        <button
          class="btn-send"
          :disabled="!inputText.trim() || loading"
          @click="sendMessage"
        >
          {{ loading ? 'Sending...' : 'Send' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-page {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 56px);
  padding: 28px 32px;
}

.chat-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  overflow: hidden;
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 12px;
  opacity: 0.5;
}

.empty-text {
  font-size: 14px;
}

.message {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-width: 80%;
  animation: fade-in var(--duration-normal) var(--ease-out);
}

.message-user {
  align-self: flex-end;
}

.message-assistant {
  align-self: flex-start;
}

.message-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.message-user .message-header {
  flex-direction: row-reverse;
}

.message-role {
  color: var(--text-muted);
}

.message-time {
  color: var(--text-faint);
  font-weight: 400;
}

.message-content {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px 16px;
  font-size: 14px;
  line-height: 1.6;
  word-wrap: break-word;
}

.message-user .message-content {
  background: var(--accent-dim);
  border-color: var(--accent);
  color: var(--text-strong);
}

.markdown-content :deep(p) {
  margin: 0 0 12px 0;
}

.markdown-content :deep(p:last-child) {
  margin-bottom: 0;
}

.markdown-content :deep(pre) {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 12px;
  overflow-x: auto;
  margin: 8px 0;
}

.markdown-content :deep(code) {
  font-family: var(--font-mono);
  font-size: 13px;
  background: var(--bg);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
}

.markdown-content :deep(pre code) {
  background: transparent;
  padding: 0;
}

.markdown-content :deep(ul),
.markdown-content :deep(ol) {
  margin: 8px 0;
  padding-left: 24px;
}

.markdown-content :deep(li) {
  margin: 4px 0;
}

.markdown-content :deep(a) {
  color: var(--accent);
  text-decoration: underline;
}

.markdown-content :deep(a:hover) {
  color: var(--accent-hover);
}

.markdown-content :deep(blockquote) {
  border-left: 3px solid var(--border-strong);
  padding-left: 12px;
  margin: 8px 0;
  color: var(--text-muted);
}

.status-indicator {
  align-self: flex-start;
  padding: 8px 12px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 13px;
  color: var(--text-muted);
  animation: fade-in var(--duration-fast) var(--ease-out);
}

.status-text {
  display: flex;
  align-items: center;
  gap: 8px;
}

.spinner {
  display: inline-block;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.input-container {
  border-top: 1px solid var(--border);
  padding: 16px;
  display: flex;
  gap: 12px;
  align-items: flex-end;
  background: var(--bg);
}

.chat-input {
  flex: 1;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  padding: 10px 14px;
  font-size: 14px;
  line-height: 1.5;
  resize: none;
  outline: none;
  transition:
    border-color var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out);
  font-family: var(--font);
}

.chat-input:focus {
  border-color: var(--accent);
  box-shadow: var(--focus-ring);
}

.chat-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-send {
  background: var(--accent);
  color: var(--accent-foreground);
  border: 1px solid var(--accent);
  padding: 10px 24px;
  border-radius: var(--radius);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out);
  white-space: nowrap;
}

.btn-send:hover:not(:disabled) {
  background: var(--accent-hover);
  border-color: var(--accent-hover);
  box-shadow: var(--shadow-sm);
}

.btn-send:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
