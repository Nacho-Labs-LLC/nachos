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
  if (status === 'healthy') return 'var(--green)';
  if (status === 'degraded') return 'var(--yellow)';
  if (status === 'unreachable') return 'var(--text-muted)';
  return 'var(--red)';
}

function modeColor(mode?: string): string {
  if (mode === 'strict') return 'var(--red)';
  if (mode === 'permissive') return 'var(--yellow)';
  return 'var(--green)';
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
  <div class="page">
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
              <div class="text-muted mono">{{ data.config.llm.model ?? '' }}</div>
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
                :style="{ background: ch.enabled ? 'var(--green)' : 'var(--text-muted)' }"
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
                :style="{ background: tool.enabled ? 'var(--green)' : 'var(--text-muted)' }"
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
.page {
  padding: 28px 32px;
  max-width: 1100px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 28px;
}

.page-title {
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.4px;
}

.page-sub {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 3px;
}

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

.alert-error {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: var(--red);
  padding: 10px 14px;
  border-radius: var(--radius);
  margin-bottom: 20px;
  font-size: 13px;
}

.loading { color: var(--text-muted); font-size: 13px; }

.section { margin-bottom: 32px; }

.section-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 12px;
}

.card-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.top-cards .card { min-width: 200px; flex: 1; }

.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px;
}

.card-sm { min-width: 130px; }

.card-disabled { opacity: 0.5; }

.card-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 10px;
}

.status-row {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 8px;
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-text { font-weight: 500; }

.text-muted { color: var(--text-muted); }
.mono { font-family: var(--font-mono); font-size: 12px; }

.meta-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 8px;
}

.meta-list div {
  display: flex;
  gap: 8px;
  font-size: 12px;
}

.meta-list dt { color: var(--text-muted); min-width: 50px; }
.meta-list dd { font-family: var(--font-mono); }

.checks {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 10px;
}

.check-chip {
  font-size: 11px;
  font-family: var(--font-mono);
  padding: 2px 6px;
  border-radius: 3px;
}

.check-ok { background: rgba(34, 197, 94, 0.12); color: var(--green); }
.check-err { background: rgba(239, 68, 68, 0.12); color: var(--red); }
</style>
