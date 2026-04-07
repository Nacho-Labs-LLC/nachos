<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, computed, watch } from 'vue';
import MarkdownIt from 'markdown-it';
import SessionDropdown from '../components/SessionDropdown.vue';
import HistoryModal from '../components/HistoryModal.vue';
import {
  createSession,
  sendMessage as sendMessageAPI,
  getMessages,
  subscribeToMessages,
  archiveSession,
  type Message,
  type MessageSubscription,
} from '../api/webchat';
import { getSync } from '../utils/sync';

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
});

interface StatusEvent {
  type: 'thinking' | 'tool' | 'done' | 'error' | 'connected';
  toolName?: string;
  error?: string;
}

const messages = ref<Message[]>([]);
const inputText = ref('');
const sessionId = ref<string | null>(null);
const sessionName = ref<string | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const currentStatus = ref<StatusEvent | null>(null);
const messageContainer = ref<HTMLElement | null>(null);
const showHistory = ref(false);
const loadingMore = ref(false);
const hasMoreMessages = ref(false);

let messageSubscription: MessageSubscription | null = null;

const messageCount = computed(() => messages.value.length);

// Multi-tab sync
const sync = getSync();

function renderMarkdown(text: string): string {
  return md.render(text);
}

async function handleNewSession() {
  if (loading.value) return;
  
  // Confirm if there's an active session
  if (sessionId.value && messages.value.length > 0) {
    if (!confirm('Create a new session? The current session will remain accessible.')) {
      return;
    }
  }
  
  loading.value = true;
  error.value = null;
  
  try {
    const result = await createSession({ channel: 'webchat' });
    
    // Unsubscribe from current session
    if (messageSubscription) {
      messageSubscription.unsubscribe();
      messageSubscription = null;
    }
    
    // Switch to new session
    sessionId.value = result.sessionId;
    sessionName.value = result.name;
    messages.value = [];
    currentStatus.value = null;
    
    // Broadcast to other tabs
    sync.broadcast('session-created', result.sessionId, {
      name: result.name,
    });
    
    // Start subscription
    subscribeToSession(result.sessionId);
  } catch (err) {
    error.value = String(err);
    console.error('[chat] Error creating session:', err);
  } finally {
    loading.value = false;
  }
}

async function handleSessionSelected(newSessionId: string) {
  if (newSessionId === sessionId.value) return;
  
  loading.value = true;
  error.value = null;
  
  try {
    // Unsubscribe from current session
    if (messageSubscription) {
      messageSubscription.unsubscribe();
      messageSubscription = null;
    }
    
    // Load messages for new session
    const result = await getMessages(newSessionId, { limit: 50 });
    
    sessionId.value = newSessionId;
    messages.value = result.messages;
    hasMoreMessages.value = result.total > result.messages.length;
    currentStatus.value = null;
    
    await nextTick();
    scrollToBottom();
    
    // Broadcast to other tabs
    sync.broadcast('session-switched', newSessionId);
    
    // Subscribe to new session
    subscribeToSession(newSessionId);
  } catch (err) {
    error.value = String(err);
    console.error('[chat] Error switching session:', err);
  } finally {
    loading.value = false;
  }
}

async function handleSessionRestored(restoredSessionId: string) {
  showHistory.value = false;
  
  // Switch to the restored session
  await handleSessionSelected(restoredSessionId);
}

async function loadMoreMessages() {
  if (!sessionId.value || loadingMore.value || !hasMoreMessages.value) return;
  
  loadingMore.value = true;
  
  try {
    const oldestMessage = messages.value[0];
    if (!oldestMessage) return;
    
    const result = await getMessages(sessionId.value, {
      limit: 50,
      offset: messages.value.length,
    });
    
    // Prepend older messages
    messages.value = [...result.messages, ...messages.value];
    hasMoreMessages.value = result.total > messages.value.length;
  } catch (err) {
    console.error('[chat] Error loading more messages:', err);
  } finally {
    loadingMore.value = false;
  }
}

function subscribeToSession(sid: string) {
  // Register subscription with sync system
  sync.registerSubscription(sid);
  
  messageSubscription = subscribeToMessages(
    sid,
    (message) => {
      // Add new message
      messages.value.push({
        id: message.id,
        sessionId: message.sessionId,
        role: message.role,
        content: message.content,
        createdAt: message.timestamp,
        toolCalls: message.toolCalls,
      });
      
      loading.value = false;
      currentStatus.value = null;
      
      nextTick(() => scrollToBottom());
    },
    {
      onStatus: (status) => {
        if (status.type === 'thinking') {
          currentStatus.value = { type: 'thinking' };
        } else if (status.type === 'tool') {
          currentStatus.value = { type: 'tool', toolName: status.tool };
        } else if (status.type === 'done') {
          currentStatus.value = { type: 'done' };
          setTimeout(() => {
            currentStatus.value = null;
          }, 1000);
        } else if (status.type === 'error') {
          currentStatus.value = { type: 'error', error: status.error };
          error.value = status.error ?? null;
          loading.value = false;
        }
      },
      onError: (err) => {
        console.error('[chat] Subscription error:', err);
        error.value = 'Connection lost. Reconnecting...';
      },
      onConnect: () => {
        console.log('[chat] Connected to session:', sid);
        error.value = null;
      },
      autoReconnect: true,
    }
  );
}

async function sendMessage() {
  if (!inputText.value.trim() || loading.value) return;
  
  const userMessage = inputText.value.trim();
  inputText.value = '';
  loading.value = true;
  error.value = null;
  
  // Create session if needed
  if (!sessionId.value) {
    try {
      const result = await createSession({ channel: 'webchat' });
      sessionId.value = result.sessionId;
      sessionName.value = result.name;
      subscribeToSession(result.sessionId);
    } catch (err) {
      error.value = String(err);
      loading.value = false;
      return;
    }
  }
  
  // Add user message immediately (optimistic update)
  const tempId = `temp-${Date.now()}`;
  messages.value.push({
    id: tempId,
    sessionId: sessionId.value,
    role: 'user',
    content: userMessage,
    createdAt: new Date().toISOString(),
  });
  
  await nextTick();
  scrollToBottom();
  
  try {
    await sendMessageAPI(sessionId.value, userMessage);
  } catch (err) {
    error.value = String(err);
    loading.value = false;
    
    // Remove optimistic message on error
    messages.value = messages.value.filter(m => m.id !== tempId);
  }
}

async function handleArchiveSession() {
  if (!sessionId.value) return;
  
  if (!confirm('Archive this session? You can restore it later from history.')) return;
  
  const archivedSessionId = sessionId.value;
  
  try {
    await archiveSession(archivedSessionId);
    
    // Broadcast to other tabs
    sync.broadcast('session-archived', archivedSessionId);
    
    // Clear current session
    if (messageSubscription) {
      messageSubscription.unsubscribe();
      sync.unregisterSubscription(archivedSessionId);
      messageSubscription = null;
    }
    
    sessionId.value = null;
    sessionName.value = null;
    messages.value = [];
    currentStatus.value = null;
  } catch (err) {
    alert(`Failed to archive session: ${err}`);
    console.error('[chat] Error archiving session:', err);
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

function handleScroll() {
  if (!messageContainer.value) return;
  
  // Check if scrolled to top
  if (messageContainer.value.scrollTop === 0 && hasMoreMessages.value) {
    loadMoreMessages();
  }
}

// Setup sync listeners
onMounted(() => {
  // Listen for session events from other tabs
  sync.on('session-created', (event) => {
    console.log('[chat] Other tab created session:', event.sessionId);
    // Could refresh session list here
  });
  
  sync.on('session-archived', (event) => {
    console.log('[chat] Other tab archived session:', event.sessionId);
    
    // If we're viewing the archived session, clear it
    if (sessionId.value === event.sessionId) {
      if (messageSubscription) {
        messageSubscription.unsubscribe();
        messageSubscription = null;
      }
      sessionId.value = null;
      sessionName.value = null;
      messages.value = [];
      currentStatus.value = null;
    }
  });
  
  sync.on('session-restored', (event) => {
    console.log('[chat] Other tab restored session:', event.sessionId);
    // Could refresh session list here
  });
  
  sync.on('session-list-updated', () => {
    console.log('[chat] Session list updated in another tab');
    // Could trigger a refresh of the session dropdown
  });
});

onUnmounted(() => {
  if (messageSubscription) {
    messageSubscription.unsubscribe();
    if (sessionId.value) {
      sync.unregisterSubscription(sessionId.value);
    }
  }
});
</script>

<template>
  <div class="page chat-page">
    <header class="page-header">
      <div class="header-left">
        <h1 class="page-title">Web Chat</h1>
        <p class="page-sub">
          Real-time messaging with session management
        </p>
      </div>
      <div class="header-actions">
        <SessionDropdown
          :current-session-id="sessionId"
          @session-selected="handleSessionSelected"
          @new-session="handleNewSession"
        />
        <button
          class="btn-ghost"
          @click="showHistory = true"
        >
          📁 History
        </button>
        <button
          v-if="sessionId"
          class="btn-ghost"
          :disabled="loading"
          @click="handleArchiveSession"
        >
          📦 Archive
        </button>
      </div>
    </header>
    
    <div v-if="error" class="alert-error">
      {{ error }}
      <button
        v-if="messageSubscription && !messageSubscription.isConnected()"
        class="btn-reconnect"
        @click="messageSubscription.reconnect()"
      >
        Reconnect
      </button>
    </div>
    
    <div class="chat-container">
      <!-- Messages -->
      <div
        ref="messageContainer"
        class="messages"
        @scroll="handleScroll"
      >
        <!-- Load more button -->
        <div v-if="hasMoreMessages && !loadingMore" class="load-more-container">
          <button class="btn-load-more" @click="loadMoreMessages">
            ↑ Load older messages
          </button>
        </div>
        <div v-if="loadingMore" class="loading-more">
          <span class="spinner">⟳</span> Loading...
        </div>
        
        <!-- Empty state -->
        <div v-if="messages.length === 0 && !loading" class="empty-state">
          <p class="empty-icon">💬</p>
          <p class="empty-text">
            {{ sessionId ? 'No messages yet' : 'Create or select a session to start chatting' }}
          </p>
        </div>
        
        <!-- Message list -->
        <div
          v-for="msg in messages"
          :key="msg.id"
          class="message"
          :class="{
            'message-user': msg.role === 'user',
            'message-assistant': msg.role === 'assistant',
            'message-system': msg.role === 'system',
          }"
        >
          <div class="message-header">
            <span class="message-role">
              {{ msg.role === 'user' ? 'You' : msg.role === 'assistant' ? 'Assistant' : 'System' }}
            </span>
            <span class="message-time">{{ formatTime(msg.createdAt) }}</span>
          </div>
          <div
            v-if="msg.role === 'assistant'"
            class="message-content markdown-content"
            v-html="renderMarkdown(msg.content)"
          ></div>
          <div v-else class="message-content">{{ msg.content }}</div>
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
    
    <!-- History Modal -->
    <HistoryModal
      :is-open="showHistory"
      @close="showHistory = false"
      @session-restored="handleSessionRestored"
    />
  </div>
</template>

<style scoped>
.chat-page {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 56px);
  padding: 28px 32px;
}

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 24px;
  gap: 24px;
}

.header-left {
  flex: 1;
  min-width: 0;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.alert-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  background: var(--error-dim);
  border: 1px solid var(--error);
  border-radius: var(--radius);
  color: var(--error);
  font-size: 13px;
  margin-bottom: 16px;
}

.btn-reconnect {
  padding: 6px 12px;
  background: var(--error);
  color: white;
  border: none;
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.chat-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  overflow: hidden;
  min-height: 0;
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.load-more-container {
  display: flex;
  justify-content: center;
  padding: 8px 0;
}

.btn-load-more {
  padding: 8px 16px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out);
}

.btn-load-more:hover {
  background: var(--surface);
  border-color: var(--border-strong);
}

.loading-more {
  text-align: center;
  padding: 12px;
  color: var(--text-muted);
  font-size: 13px;
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
  text-align: center;
  max-width: 300px;
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

.message-assistant,
.message-system {
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

.message-system .message-content {
  background: var(--bg);
  border-color: var(--border);
  color: var(--text-muted);
  font-style: italic;
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

@keyframes fade-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
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
