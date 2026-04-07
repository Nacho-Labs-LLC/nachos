<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import {
  listArchivedSessions,
  restoreSession,
  deleteSession,
  type ArchivedSessionInfo,
} from '../api/webchat';
import { getSync } from '../utils/sync';

const props = defineProps<{
  isOpen: boolean;
}>();

const emit = defineEmits<{
  close: [];
  'session-restored': [sessionId: string];
}>();

const sessions = ref<ArchivedSessionInfo[]>([]);
const total = ref(0);
const loading = ref(false);
const error = ref<string | null>(null);
const searchQuery = ref('');
const currentPage = ref(1);
const pageSize = 20;

const filteredSessions = computed(() => {
  if (!searchQuery.value.trim()) {
    return sessions.value;
  }
  
  const query = searchQuery.value.toLowerCase();
  return sessions.value.filter(s =>
    s.name.toLowerCase().includes(query)
  );
});

const totalPages = computed(() => Math.ceil(total.value / pageSize));

// Multi-tab sync
const sync = getSync();

async function loadSessions() {
  loading.value = true;
  error.value = null;
  
  try {
    const offset = (currentPage.value - 1) * pageSize;
    const result = await listArchivedSessions({
      channel: 'webchat',
      search: searchQuery.value || undefined,
      limit: pageSize,
      offset,
    });
    
    sessions.value = result.sessions;
    total.value = result.total;
  } catch (err) {
    error.value = String(err);
    console.error('[HistoryModal] Error loading archived sessions:', err);
  } finally {
    loading.value = false;
  }
}

async function handleRestore(sessionId: string) {
  if (!confirm('Restore this session? It will become active again.')) return;
  
  try {
    await restoreSession(sessionId);
    
    // Broadcast to other tabs
    sync.broadcast('session-restored', sessionId);
    
    // Remove from list
    sessions.value = sessions.value.filter(s => s.id !== sessionId);
    total.value--;
    
    emit('session-restored', sessionId);
  } catch (err) {
    alert(`Failed to restore session: ${err}`);
    console.error('[HistoryModal] Error restoring session:', err);
  }
}

async function handleDelete(sessionId: string) {
  if (!confirm('Delete this session permanently? This cannot be undone.')) return;
  
  try {
    await deleteSession(sessionId);
    
    // Broadcast to other tabs
    sync.broadcast('session-deleted', sessionId);
    
    // Remove from list
    sessions.value = sessions.value.filter(s => s.id !== sessionId);
    total.value--;
  } catch (err) {
    alert(`Failed to delete session: ${err}`);
    console.error('[HistoryModal] Error deleting session:', err);
  }
}

function handleSearch() {
  currentPage.value = 1;
  loadSessions();
}

function nextPage() {
  if (currentPage.value < totalPages.value) {
    currentPage.value++;
    loadSessions();
  }
}

function prevPage() {
  if (currentPage.value > 1) {
    currentPage.value--;
    loadSessions();
  }
}

function handleClose() {
  searchQuery.value = '';
  currentPage.value = 1;
  emit('close');
}

function formatDate(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Load sessions when modal opens
watch(() => props.isOpen, (isOpen) => {
  if (isOpen) {
    loadSessions();
  }
});
</script>

<template>
  <Transition name="modal">
    <div v-if="isOpen" class="modal-overlay" @click="handleClose">
      <div class="modal-container" @click.stop>
        <header class="modal-header">
          <h2 class="modal-title">Session History</h2>
          <button class="btn-close" @click="handleClose">✕</button>
        </header>
        
        <div class="modal-body">
          <!-- Search -->
          <div class="search-container">
            <input
              v-model="searchQuery"
              type="text"
              class="search-input"
              placeholder="Search sessions..."
              @keyup.enter="handleSearch"
            />
            <button class="btn-search" @click="handleSearch">
              Search
            </button>
          </div>
          
          <!-- Loading state -->
          <div v-if="loading" class="loading-state">
            <span class="spinner">⟳</span> Loading sessions...
          </div>
          
          <!-- Error state -->
          <div v-else-if="error" class="error-state">
            <p class="error-message">{{ error }}</p>
            <button class="btn-retry" @click="loadSessions">
              Retry
            </button>
          </div>
          
          <!-- Empty state -->
          <div v-else-if="filteredSessions.length === 0" class="empty-state">
            <p class="empty-icon">📁</p>
            <p class="empty-text">
              {{ searchQuery ? 'No sessions match your search' : 'No archived sessions' }}
            </p>
          </div>
          
          <!-- Session list -->
          <div v-else class="session-list">
            <div
              v-for="session in filteredSessions"
              :key="session.id"
              class="session-card"
            >
              <div class="session-header">
                <h3 class="session-name">{{ session.name }}</h3>
                <div class="session-actions">
                  <button
                    class="btn-icon btn-restore"
                    title="Restore session"
                    @click="handleRestore(session.id)"
                  >
                    ↺
                  </button>
                  <button
                    class="btn-icon btn-delete"
                    title="Delete permanently"
                    @click="handleDelete(session.id)"
                  >
                    🗑️
                  </button>
                </div>
              </div>
              
              <div class="session-meta">
                <span class="meta-item">
                  <span class="meta-label">Archived:</span>
                  {{ formatDate(session.archivedAt) }}
                </span>
                <span class="meta-separator">·</span>
                <span class="meta-item">
                  {{ session.messageCount }} messages
                </span>
              </div>
            </div>
          </div>
          
          <!-- Pagination -->
          <div v-if="totalPages > 1" class="pagination">
            <button
              class="btn-page"
              :disabled="currentPage === 1"
              @click="prevPage"
            >
              ← Previous
            </button>
            <span class="page-info">
              Page {{ currentPage }} of {{ totalPages }}
            </span>
            <button
              class="btn-page"
              :disabled="currentPage === totalPages"
              @click="nextPage"
            >
              Next →
            </button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

.modal-container {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  width: 100%;
  max-width: 700px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-xl);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid var(--border);
  background: var(--bg);
}

.modal-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--text-strong);
  margin: 0;
}

.btn-close {
  background: transparent;
  border: none;
  font-size: 24px;
  color: var(--text-muted);
  cursor: pointer;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  transition: background var(--duration-fast) var(--ease-out);
}

.btn-close:hover {
  background: var(--surface-2);
  color: var(--text);
}

.modal-body {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.search-container {
  display: flex;
  gap: 12px;
}

.search-input {
  flex: 1;
  padding: 10px 14px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  font-size: 14px;
  outline: none;
  transition:
    border-color var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out);
}

.search-input:focus {
  border-color: var(--accent);
  box-shadow: var(--focus-ring);
}

.btn-search {
  padding: 10px 20px;
  background: var(--accent);
  color: var(--accent-foreground);
  border: none;
  border-radius: var(--radius);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out);
  white-space: nowrap;
}

.btn-search:hover {
  background: var(--accent-hover);
}

.loading-state,
.error-state,
.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  color: var(--text-muted);
}

.spinner {
  display: inline-block;
  animation: spin 1s linear infinite;
  font-size: 24px;
  margin-bottom: 12px;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.error-message {
  color: var(--error);
  margin-bottom: 16px;
}

.btn-retry {
  padding: 8px 16px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  font-size: 14px;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out);
}

.btn-retry:hover {
  background: var(--surface);
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 12px;
  opacity: 0.5;
}

.empty-text {
  font-size: 14px;
}

.session-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.session-card {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px;
  transition: border-color var(--duration-fast) var(--ease-out);
}

.session-card:hover {
  border-color: var(--border-strong);
}

.session-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.session-name {
  font-size: 15px;
  font-weight: 500;
  color: var(--text-strong);
  margin: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-actions {
  display: flex;
  gap: 6px;
}

.btn-icon {
  padding: 6px 10px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 14px;
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out);
}

.btn-icon:hover {
  background: var(--surface);
  border-color: var(--border-strong);
}

.btn-restore:hover {
  background: var(--success-dim);
  border-color: var(--success);
  color: var(--success);
}

.btn-delete:hover {
  background: var(--error-dim);
  border-color: var(--error);
}

.session-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-muted);
}

.meta-separator {
  opacity: 0.5;
}

.meta-label {
  font-weight: 600;
}

.pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}

.btn-page {
  padding: 8px 16px;
  background: var(--surface);
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

.btn-page:hover:not(:disabled) {
  background: var(--surface-2);
  border-color: var(--border-strong);
}

.btn-page:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.page-info {
  font-size: 13px;
  color: var(--text-muted);
  font-weight: 500;
}

/* Modal transition */
.modal-enter-active,
.modal-leave-active {
  transition: opacity var(--duration-normal) var(--ease-out);
}

.modal-enter-active .modal-container,
.modal-leave-active .modal-container {
  transition: transform var(--duration-normal) var(--ease-out);
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .modal-container,
.modal-leave-to .modal-container {
  transform: scale(0.95) translateY(-20px);
}
</style>
