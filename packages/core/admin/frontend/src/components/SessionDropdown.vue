<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { listActiveSessions, pinSession, type SessionInfo } from '../api/webchat';

const props = defineProps<{
  currentSessionId: string | null;
}>();

const emit = defineEmits<{
  'session-selected': [sessionId: string];
  'new-session': [];
}>();

const sessions = ref<SessionInfo[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const isOpen = ref(false);
const dropdownRef = ref<HTMLElement | null>(null);

const currentSession = computed(() => {
  if (!props.currentSessionId) return null;
  return sessions.value.find(s => s.id === props.currentSessionId) || null;
});

const sortedSessions = computed(() => {
  return [...sessions.value].sort((a, b) => {
    // Pinned sessions first
    if (a.isPinned !== b.isPinned) {
      return a.isPinned ? -1 : 1;
    }
    // Then by most recent activity
    return new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime();
  });
});

async function loadSessions() {
  loading.value = true;
  error.value = null;
  
  try {
    sessions.value = await listActiveSessions({ channel: 'webchat' });
  } catch (err) {
    error.value = String(err);
    console.error('[SessionDropdown] Error loading sessions:', err);
  } finally {
    loading.value = false;
  }
}

async function togglePin(sessionId: string, event: Event) {
  event.stopPropagation();
  
  const session = sessions.value.find(s => s.id === sessionId);
  if (!session) return;
  
  try {
    await pinSession(sessionId, !session.isPinned);
    session.isPinned = !session.isPinned;
  } catch (err) {
    console.error('[SessionDropdown] Error toggling pin:', err);
  }
}

function selectSession(sessionId: string) {
  if (sessionId !== props.currentSessionId) {
    emit('session-selected', sessionId);
  }
  isOpen.value = false;
}

function toggleDropdown() {
  if (!isOpen.value) {
    loadSessions(); // Lazy load on open
  }
  isOpen.value = !isOpen.value;
}

function handleClickOutside(event: MouseEvent) {
  if (dropdownRef.value && !dropdownRef.value.contains(event.target as Node)) {
    isOpen.value = false;
  }
}

// Close dropdown when session changes
watch(() => props.currentSessionId, () => {
  isOpen.value = false;
});

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
});

function formatRelativeTime(timestamp: string): string {
  const now = Date.now();
  const date = new Date(timestamp);
  const diff = now - date.getTime();
  
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}
</script>

<template>
  <div ref="dropdownRef" class="session-dropdown">
    <button
      class="dropdown-trigger"
      :class="{ 'is-open': isOpen }"
      @click="toggleDropdown"
    >
      <span class="session-label">
        <span class="label-text">Session:</span>
        <span class="session-name">
          {{ currentSession?.name || 'No session' }}
        </span>
      </span>
      <span class="dropdown-icon">▼</span>
    </button>
    
    <Transition name="dropdown">
      <div v-if="isOpen" class="dropdown-menu">
        <div class="dropdown-header">
          <span class="header-title">Active Sessions</span>
          <button
            class="btn-new-session"
            @click="emit('new-session')"
          >
            + New
          </button>
        </div>
        
        <div v-if="loading" class="dropdown-loading">
          <span class="spinner">⟳</span> Loading...
        </div>
        
        <div v-else-if="error" class="dropdown-error">
          {{ error }}
        </div>
        
        <div v-else-if="sortedSessions.length === 0" class="dropdown-empty">
          No active sessions
        </div>
        
        <div v-else class="session-list">
          <button
            v-for="session in sortedSessions"
            :key="session.id"
            class="session-item"
            :class="{ 'is-active': session.id === currentSessionId }"
            @click="selectSession(session.id)"
          >
            <div class="session-info">
              <div class="session-name-row">
                <span class="session-name">{{ session.name }}</span>
                <button
                  class="btn-pin"
                  :class="{ 'is-pinned': session.isPinned }"
                  :title="session.isPinned ? 'Unpin' : 'Pin'"
                  @click="togglePin(session.id, $event)"
                >
                  📌
                </button>
              </div>
              <div class="session-meta">
                <span class="message-count">{{ session.messageCount }} messages</span>
                <span class="separator">·</span>
                <span class="last-activity">{{ formatRelativeTime(session.lastActivity) }}</span>
              </div>
            </div>
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.session-dropdown {
  position: relative;
}

.dropdown-trigger {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  font-size: 14px;
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out);
  min-width: 280px;
}

.dropdown-trigger:hover {
  background: var(--surface-2);
  border-color: var(--border-strong);
}

.dropdown-trigger.is-open {
  border-color: var(--accent);
  box-shadow: var(--focus-ring);
}

.session-label {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
}

.label-text {
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  white-space: nowrap;
}

.session-name {
  color: var(--text-strong);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dropdown-icon {
  color: var(--text-muted);
  font-size: 10px;
  transition: transform var(--duration-fast) var(--ease-out);
}

.dropdown-trigger.is-open .dropdown-icon {
  transform: rotate(180deg);
}

.dropdown-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  min-width: 100%;
  max-width: 400px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  z-index: 100;
  max-height: 500px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.dropdown-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--bg);
}

.header-title {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
}

.btn-new-session {
  padding: 4px 12px;
  background: var(--accent);
  color: var(--accent-foreground);
  border: none;
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out);
}

.btn-new-session:hover {
  background: var(--accent-hover);
}

.dropdown-loading,
.dropdown-error,
.dropdown-empty {
  padding: 24px 16px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}

.dropdown-error {
  color: var(--error);
}

.spinner {
  display: inline-block;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.session-list {
  overflow-y: auto;
  max-height: 400px;
}

.session-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out);
  text-align: left;
}

.session-item:last-child {
  border-bottom: none;
}

.session-item:hover {
  background: var(--surface-2);
}

.session-item.is-active {
  background: var(--accent-dim);
  border-color: var(--accent);
}

.session-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.session-name-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.session-item .session-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.btn-pin {
  padding: 2px 4px;
  background: transparent;
  border: none;
  font-size: 12px;
  cursor: pointer;
  opacity: 0.4;
  transition: opacity var(--duration-fast) var(--ease-out);
}

.session-item:hover .btn-pin {
  opacity: 0.7;
}

.btn-pin.is-pinned,
.btn-pin:hover {
  opacity: 1;
}

.session-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted);
}

.separator {
  opacity: 0.5;
}

.last-activity {
  font-style: italic;
}

/* Dropdown transition */
.dropdown-enter-active,
.dropdown-leave-active {
  transition:
    opacity var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
