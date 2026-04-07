<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { getAudit, getAuditEventTypes, type AuditRow, type AuditResponse } from '../api/client.js';

const data = ref<AuditResponse | null>(null);
const eventTypes = ref<string[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

const filters = ref({
  page: 1,
  pageSize: 50,
  event_type: '',
  channel: '',
  outcome: '',
});

async function load() {
  loading.value = true;
  try {
    const f = filters.value;
    data.value = await getAudit({
      page: f.page,
      pageSize: f.pageSize,
      event_type: f.event_type || undefined,
      channel: f.channel || undefined,
      outcome: f.outcome || undefined,
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

function outcomeColor(outcome: string): string {
  if (outcome === 'allow') return 'var(--ok)';
  if (outcome === 'block' || outcome === 'error') return 'var(--danger)';
  if (outcome === 'warn') return 'var(--warn)';
  return 'var(--text-muted)';
}

function fmt(ts: string): string {
  return new Date(ts).toLocaleString();
}

function truncate(s: string | null, len = 60): string {
  if (!s) return '—';
  return s.length > len ? s.slice(0, len) + '…' : s;
}

const totalPages = () => (data.value ? Math.ceil(data.value.total / filters.value.pageSize) : 1);

onMounted(async () => {
  eventTypes.value = await getAuditEventTypes().catch(() => []);
  await load();
});

watch(() => [filters.value.event_type, filters.value.channel, filters.value.outcome], resetPage);
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <h1 class="page-title">Audit Log</h1>
        <p v-if="data" class="page-sub">{{ data.total.toLocaleString() }} events</p>
      </div>
      <button class="btn-ghost" :disabled="loading" @click="load">
        {{ loading ? 'Loading…' : '↻ Refresh' }}
      </button>
    </header>

    <!-- Filters -->
    <div class="filter-bar">
      <select v-model="filters.event_type" class="filter-input" @change="resetPage">
        <option value="">All event types</option>
        <option v-for="et in eventTypes" :key="et" :value="et">{{ et }}</option>
      </select>

      <select v-model="filters.outcome" class="filter-input" @change="resetPage">
        <option value="">All outcomes</option>
        <option value="allow">allow</option>
        <option value="block">block</option>
        <option value="warn">warn</option>
        <option value="audit">audit</option>
        <option value="redact">redact</option>
      </select>

      <input
        v-model="filters.channel"
        type="text"
        class="filter-input"
        placeholder="Filter by channel…"
        @keyup.enter="resetPage"
      />
    </div>

    <div v-if="error" class="alert-error">{{ error }}</div>

    <div v-if="!data && loading" class="loading">Loading…</div>

    <template v-if="data">
      <div v-if="data.events.length === 0" class="empty">
        No audit events found.
        <span v-if="!data.total">The audit log may not exist yet — start the gateway to generate events.</span>
      </div>

      <div v-else class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Type</th>
              <th>Action</th>
              <th>Channel</th>
              <th>User</th>
              <th>Outcome</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in data.events" :key="row.id">
              <td class="mono td-time">{{ fmt(row.timestamp) }}</td>
              <td class="mono td-type">{{ row.event_type }}</td>
              <td class="td-action">{{ truncate(row.action, 40) }}</td>
              <td class="mono">{{ row.channel || '—' }}</td>
              <td class="mono">{{ truncate(row.user_id, 16) }}</td>
              <td>
                <span class="status-chip" :style="{ color: outcomeColor(row.outcome), borderColor: outcomeColor(row.outcome) }">
                  {{ row.outcome }}
                </span>
              </td>
              <td class="td-reason">{{ truncate(row.reason, 50) }}</td>
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
          ← Prev
        </button>
        <span class="page-info">Page {{ filters.page }} of {{ totalPages() }}</span>
        <button
          class="page-btn"
          :disabled="filters.page >= totalPages()"
          @click="() => { filters.page++; void load(); }"
        >
          Next →
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.td-time { white-space: nowrap; color: var(--text-muted); }
.td-type { color: var(--info); white-space: nowrap; }
.td-action, .td-reason { max-width: 200px; word-break: break-all; }
</style>
