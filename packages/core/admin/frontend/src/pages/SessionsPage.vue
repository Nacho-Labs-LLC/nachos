<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import {
  getSessions,
  expireSession,
  type SessionRow,
  type SessionsResponse,
} from '../api/client.js';

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
  if (status === 'active') return 'var(--ok)';
  if (status === 'paused') return 'var(--warn)';
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
        <span v-if="!data.total"
          >The sessions database may not exist yet \u2014 start the gateway to create
          sessions.</span
        >
      </div>

      <div v-else class="table-wrap">
        <table class="data-table">
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
            <tr v-for="row in data.sessions" :key="row.id">
              <td class="mono">{{ row.channel }}</td>
              <td class="mono">{{ truncate(row.user_id) }}</td>
              <td>
                <span
                  class="status-chip"
                  :style="{ color: statusColor(row.status), borderColor: statusColor(row.status) }"
                >
                  {{ row.status }}
                </span>
              </td>
              <td class="mono td-count">{{ row.message_count }}</td>
              <td class="mono td-time">{{ fmt(row.created_at) }}</td>
              <td class="mono td-time">{{ fmt(row.updated_at) }}</td>
              <td>
                <button
                  v-if="row.status === 'active' || row.status === 'paused'"
                  class="btn-danger"
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
          @click="
            () => {
              filters.page--;
              void load();
            }
          "
        >
          \u2190 Prev
        </button>
        <span class="page-info">Page {{ filters.page }} of {{ totalPages() }}</span>
        <button
          class="page-btn"
          :disabled="filters.page >= totalPages()"
          @click="
            () => {
              filters.page++;
              void load();
            }
          "
        >
          Next \u2192
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.td-time {
  white-space: nowrap;
  color: var(--text-muted);
}
.td-count {
  text-align: center;
}
</style>
