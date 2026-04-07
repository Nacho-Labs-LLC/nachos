<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { getStatus, type StatusResponse } from '../api/client.js';

const data = ref<StatusResponse | null>(null);
const error = ref<string | null>(null);
const loading = ref(true);
let interval: ReturnType<typeof setInterval> | null = null;

async function refresh() {
  try {
    data.value = await getStatus();
    error.value = null;
  } catch (e) {
    error.value = String(e);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void refresh();
  interval = setInterval(() => void refresh(), 30_000);
});

onUnmounted(() => {
  if (interval) clearInterval(interval);
});

function statusColor(status: string): string {
  if (status === 'healthy') return 'var(--ok)';
  if (status === 'degraded') return 'var(--warn)';
  if (status === 'unreachable') return 'var(--text-muted)';
  return 'var(--danger)';
}

function modeColor(mode?: string): string {
  if (mode === 'strict') return 'var(--danger)';
  if (mode === 'permissive') return 'var(--warn)';
  return 'var(--ok)';
}

function formatUptime(seconds?: number): string {
  if (!seconds) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
</script>

<template>
  <div class="page status-page">
    <header class="page-header">
      <div>
        <h1 class="page-title">System Status</h1>
        <p v-if="data" class="page-sub">
          Last updated {{ new Date(data.timestamp).toLocaleTimeString() }}
        </p>
      </div>
      <button class="btn-ghost" :disabled="loading" @click="refresh">
        {{ loading ? 'Refreshing…' : '↻ Refresh' }}
      </button>
    </header>

    <div v-if="error" class="alert-error">{{ error }}</div>

    <div v-if="loading && !data" class="loading">Loading…</div>

    <template v-if="data">
      <!-- Top cards row -->
      <section class="section">
        <div class="card-grid top-cards">
          <!-- Gateway -->
          <div class="card">
            <div class="card-label">Gateway</div>
            <div class="status-row">
              <span
                class="status-dot"
                :style="{ background: statusColor(data.gateway.status) }"
              />
              <span class="status-text">{{ data.gateway.status }}</span>
            </div>
            <dl class="meta-list">
              <div v-if="data.gateway.version">
                <dt>Version</dt>
                <dd>{{ data.gateway.version }}</dd>
              </div>
              <div v-if="data.gateway.uptime != null">
                <dt>Uptime</dt>
                <dd>{{ formatUptime(data.gateway.uptime) }}</dd>
              </div>
            </dl>
            <div v-if="data.gateway.checks" class="checks">
              <span
                v-for="(val, key) in data.gateway.checks"
                :key="key"
                class="check-chip"
                :class="val === 'ok' ? 'check-ok' : 'check-err'"
              >
                {{ key }}: {{ val }}
              </span>
            </div>
          </div>

          <!-- Security -->
          <div class="card">
            <div class="card-label">Security</div>
            <div class="status-row" v-if="data.config?.security.mode">
              <span
                class="status-dot"
                :style="{ background: modeColor(data.config.security.mode) }"
              />
              <span class="status-text">{{ data.config.security.mode }} mode</span>
            </div>
            <div v-else class="status-row text-muted">—</div>
          </div>

          <!-- LLM -->
          <div class="card">
            <div class="card-label">LLM</div>
            <template v-if="data.config?.llm">
              <div class="status-text">{{ data.config.llm.provider ?? '—' }}</div>
              <div class="text-muted mono" style="font-size: 12px;">{{ data.config.llm.model ?? '' }}</div>
            </template>
            <div v-else class="text-muted">No config</div>
          </div>
        </div>
      </section>

      <!-- Channels -->
      <section class="section" v-if="data.config?.channels">
        <h2 class="section-title">Channels</h2>
        <div class="card-grid">
          <div
            v-for="(ch, name) in data.config.channels"
            :key="name"
            class="card card-sm"
            :class="{ 'card-disabled': !ch.enabled }"
          >
            <div class="card-label">{{ name }}</div>
            <div class="status-row">
              <span
                class="status-dot"
                :style="{ background: ch.enabled ? 'var(--ok)' : 'var(--text-muted)' }"
              />
              <span>{{ ch.enabled ? 'enabled' : 'disabled' }}</span>
            </div>
          </div>
        </div>
      </section>

      <!-- Tools -->
      <section class="section" v-if="data.config?.tools">
        <h2 class="section-title">Tools</h2>
        <div class="card-grid">
          <div
            v-for="(tool, name) in data.config.tools"
            :key="name"
            class="card card-sm"
            :class="{ 'card-disabled': !tool.enabled }"
          >
            <div class="card-label">{{ name }}</div>
            <div class="status-row">
              <span
                class="status-dot"
                :style="{ background: tool.enabled ? 'var(--ok)' : 'var(--text-muted)' }"
              />
              <span>{{ tool.enabled ? 'enabled' : 'disabled' }}</span>
            </div>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.status-page {
  max-width: 1100px;
}

.section {
  margin-bottom: 32px;
}

.section-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 12px;
}

.top-cards .card {
  min-width: 200px;
  flex: 1;
}

.status-text {
  font-weight: 500;
}

.checks {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 12px;
}

.check-chip {
  font-size: 11px;
  font-family: var(--font-mono);
  padding: 2px 8px;
  border-radius: var(--radius-sm);
}

.check-ok {
  background: var(--ok-subtle);
  color: var(--ok);
}

.check-err {
  background: var(--danger-subtle);
  color: var(--danger);
}
</style>
