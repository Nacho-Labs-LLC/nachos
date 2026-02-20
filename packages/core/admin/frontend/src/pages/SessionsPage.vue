<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { getSessions, expireSession, type SessionRow, type SessionsResponse } from '../api/client.js';

const data = ref<SessionsResponse | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
let interval: ReturnType<typeof setInterval> | null = null;

const filters = ref({
  page: 1,
  pageSize: 50,
  status: '',
  channel: '',
});

async function load() {
  loading.value = true;
  try {
    const f = filters.value;
    data.value = await getSessions({
      page: f.page,
      pageSize: f.pageSize,
      status: f.status || undefined,
      channel: f.channel || undefined,
    });
    error.value = null;
  } catch (e) {
    error.value = String(e);
  } finally {
    loading.value = false;
  }
}

function resetPage() {
  filters.value.page = 1;
  void load();
}

async function handleExpire(session: SessionRow) {
  if (!confirm('Force expire this session?')) return;
  try {
    await expireSession(session.id);
    await load();
  } catch (e) {
    error.value = String(e);
  }
}

function statusColor(status: string): string {
  if (status === 'active') return 'var(--green)';
  if (status === 'paused') return 'var(--yellow)';
  return 'var(--text-muted)';
}

function fmt(ts: string): string {
  return new Date(ts).toLocaleString();
}

function truncate(s: string | null, len = 20): string {
  if (!s) return '\u2014';
  return s.length > len ? s.slice(0, len) + '\u2026' : s;
}

const totalPages = () => (data.value ? Math.ceil(data.value.total / filters.value.pageSize) : 1);

onMounted(() => {
  void load();
  interval = setInterval(() => void load(), 30_000);
});

onUnmounted(() => {
  if (interval) clearInterval(interval);
});

watch(() => [filters.value.status, filters.value.channel], resetPage);
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <h1 class="page-title">Sessions</h1>
        <p v-if="data" class="page-sub">{{ data.total.toLocaleString() }} sessions</p>
      </div>
      <button class="btn-ghost" :disabled="loading" @click="load">
        {{ loading ? 'Loading\u2026' : '\u21BB Refresh' }}
      </button>
    </header>

    <!-- Filters -->
    <div class="filter-bar">
      <select v-model="filters.status" class="filter-input" @change="resetPage">
        <option value="">All statuses</option>
        <option value="active">active</option>
        <option value="paused">paused</option>
        <option value="ended">ended</option>
      </select>

      <input
        v-model="filters.channel"
        type="text"
        class="filter-input"
        placeholder="Filter by channel\u2026"
        @keyup.enter="resetPage"
      />
    </div>

    <div v-if="error" class="alert-error">{{ error }}</div>

    <div v-if="!data && loading" class="loading">Loading\u2026</div>

    <template v-if="data">
      <div v-if="data.sessions.length === 0" class="empty">
        No sessions found.
        <span v-if="!data.total">The sessions database may not exist yet \u2014 start the gateway to create sessions.</span>
      </div>

      <div v-else class="table-wrap">
        <table class="sessions-table">
          <thead>
            <tr>
              <th>Channel</th>
              <th>User</th>
              <th>Status</th>
              <th>Messages</th>
              <th>Created</th>
              <th>Last Active</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in data.sessions" :key="row.id" class="session-row">
              <td class="mono">{{ row.channel }}</td>
              <td class="mono">{{ truncate(row.user_id) }}</td>
              <td>
                <span class="status-chip" :style="{ color: statusColor(row.status), borderColor: statusColor(row.status) }">
                  {{ row.status }}
                </span>
              </td>
              <td class="mono td-count">{{ row.message_count }}</td>
              <td class="mono td-time">{{ fmt(row.created_at) }}</td>
              <td class="mono td-time">{{ fmt(row.updated_at) }}</td>
              <td>
                <button
                  v-if="row.status === 'active' || row.status === 'paused'"
                  class="btn-expire"
                  @click="handleExpire(row)"
                >
                  Expire
                </button>
                <span v-else class="text-muted">\u2014</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Pagination -->
      <div v-if="data.total > filters.pageSize" class="pagination">
        <button
          class="page-btn"
          :disabled="filters.page <= 1"
          @click="() => { filters.page--; void load(); }"
        >
          \u2190 Prev
        </button>
        <span class="page-info">Page {{ filters.page }} of {{ totalPages() }}</span>
        <button
          class="page-btn"
          :disabled="filters.page >= totalPages()"
          @click="() => { filters.page++; void load(); }"
        >
          Next \u2192
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.page { padding: 28px 32px; }

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 20px;
}

.page-title { font-size: 20px; font-weight: 700; letter-spacing: -0.4px; }
.page-sub { font-size: 12px; color: var(--text-muted); margin-top: 3px; }

.btn-ghost {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-muted);
  padding: 6px 12px;
  border-radius: var(--radius);
  font-size: 13px;
  transition: color 0.1s, border-color 0.1s;
}
.btn-ghost:hover { color: var(--text); border-color: var(--text-muted); }
.btn-ghost:disabled { opacity: 0.4; cursor: not-allowed; }

.filter-bar {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.filter-input {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  padding: 6px 10px;
  font-size: 13px;
  outline: none;
  min-width: 160px;
  transition: border-color 0.1s;
}
.filter-input:focus { border-color: var(--accent); }

.alert-error {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: var(--red);
  padding: 10px 14px;
  border-radius: var(--radius);
  margin-bottom: 16px;
  font-size: 13px;
}

.loading, .empty { color: var(--text-muted); font-size: 13px; }

.table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: var(--radius); }

.sessions-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}

.sessions-table th {
  text-align: left;
  padding: 9px 12px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text-muted);
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}

.session-row { border-bottom: 1px solid var(--border); transition: background 0.1s; }
.session-row:last-child { border-bottom: none; }
.session-row:hover { background: var(--surface); }

.session-row td { padding: 8px 12px; vertical-align: top; }

.mono { font-family: var(--font-mono); }
.td-time { white-space: nowrap; color: var(--text-muted); }
.td-count { text-align: center; }
.text-muted { color: var(--text-muted); }

.status-chip {
  display: inline-block;
  font-size: 11px;
  font-family: var(--font-mono);
  padding: 2px 6px;
  border-radius: 3px;
  border: 1px solid;
  white-space: nowrap;
}

.btn-expire {
  background: transparent;
  border: 1px solid var(--red);
  color: var(--red);
  padding: 3px 8px;
  border-radius: var(--radius);
  font-size: 11px;
  cursor: pointer;
  transition: background 0.1s;
}
.btn-expire:hover { background: rgba(239, 68, 68, 0.1); }

.pagination {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
  justify-content: center;
}

.page-btn {
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text-muted);
  padding: 5px 12px;
  border-radius: var(--radius);
  font-size: 12px;
  transition: color 0.1s;
}
.page-btn:hover:not(:disabled) { color: var(--text); }
.page-btn:disabled { opacity: 0.3; cursor: not-allowed; }

.page-info { font-size: 12px; color: var(--text-muted); }
</style>
