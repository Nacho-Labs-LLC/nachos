<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import {
  getServices,
  restartService,
  stopService,
  startService,
  type ServiceStatus,
  type ServicesResponse,
} from '../api/client.js';

const data = ref<ServicesResponse | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const actionError = ref<string | null>(null);
const pendingAction = ref<string | null>(null); // "name:action"
let interval: ReturnType<typeof setInterval> | null = null;

async function load() {
  loading.value = true;
  try {
    data.value = await getServices();
    error.value = null;
  } catch (e) {
    error.value = String(e);
  } finally {
    loading.value = false;
  }
}

function stateColor(state: string): string {
  if (state === 'running') return 'var(--green)';
  if (state === 'paused') return 'var(--yellow)';
  if (state === 'restarting') return 'var(--yellow)';
  return 'var(--red)';
}

function healthColor(health: string): string {
  if (health === 'healthy') return 'var(--green)';
  if (health === 'unhealthy') return 'var(--red)';
  if (health === 'starting') return 'var(--yellow)';
  return 'var(--text-muted)';
}

function isRunning(svc: ServiceStatus): boolean {
  return svc.state === 'running' || svc.state === 'restarting';
}

function isPending(svc: ServiceStatus, action: string): boolean {
  return pendingAction.value === `${svc.name}:${action}`;
}

async function handleRestart(svc: ServiceStatus) {
  if (!confirm(`Restart nachos-${svc.name}?`)) return;
  pendingAction.value = `${svc.name}:restart`;
  actionError.value = null;
  try {
    await restartService(svc.name);
    await load();
  } catch (e) {
    actionError.value = String(e);
  } finally {
    pendingAction.value = null;
  }
}

async function handleStop(svc: ServiceStatus) {
  if (!confirm(`Stop nachos-${svc.name}?`)) return;
  pendingAction.value = `${svc.name}:stop`;
  actionError.value = null;
  try {
    await stopService(svc.name);
    await load();
  } catch (e) {
    actionError.value = String(e);
  } finally {
    pendingAction.value = null;
  }
}

async function handleStart(svc: ServiceStatus) {
  pendingAction.value = `${svc.name}:start`;
  actionError.value = null;
  try {
    await startService(svc.name);
    await load();
  } catch (e) {
    actionError.value = String(e);
  } finally {
    pendingAction.value = null;
  }
}

onMounted(() => {
  void load();
  interval = setInterval(() => void load(), 30_000);
});

onUnmounted(() => {
  if (interval) clearInterval(interval);
});
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <h1 class="page-title">Services</h1>
        <p v-if="data" class="page-sub">
          {{ data.services.length }} nachos container{{ data.services.length !== 1 ? 's' : '' }}
        </p>
      </div>
      <button class="btn-ghost" :disabled="loading" @click="load">
        {{ loading ? 'Loading\u2026' : '\u21BB Refresh' }}
      </button>
    </header>

    <div v-if="error" class="alert-error">{{ error }}</div>
    <div v-if="actionError" class="alert-error">{{ actionError }}</div>

    <div v-if="!data && loading" class="loading">Loading\u2026</div>

    <template v-if="data">
      <div v-if="data.services.length === 0" class="empty">
        No nachos containers found. Is the stack running?
      </div>

      <div v-else class="table-wrap">
        <table class="services-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>State</th>
              <th>Health</th>
              <th>Uptime / Status</th>
              <th>Image</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="svc in data.services" :key="svc.name" class="service-row">
              <td class="mono td-name">{{ svc.name }}</td>
              <td>
                <span
                  class="state-chip"
                  :style="{ color: stateColor(svc.state), borderColor: stateColor(svc.state) }"
                >
                  {{ svc.state }}
                </span>
              </td>
              <td>
                <span
                  v-if="svc.health !== 'none'"
                  class="state-chip"
                  :style="{ color: healthColor(svc.health), borderColor: healthColor(svc.health) }"
                >
                  {{ svc.health }}
                </span>
                <span v-else class="text-muted">\u2014</span>
              </td>
              <td class="mono td-uptime">{{ svc.uptime }}</td>
              <td class="mono td-image">{{ svc.image }}</td>
              <td class="td-actions">
                <button
                  class="btn-action btn-restart"
                  :disabled="!!pendingAction"
                  :class="{ loading: isPending(svc, 'restart') }"
                  @click="handleRestart(svc)"
                >
                  {{ isPending(svc, 'restart') ? '\u2026' : 'Restart' }}
                </button>
                <button
                  v-if="isRunning(svc)"
                  class="btn-action btn-stop"
                  :disabled="!!pendingAction"
                  :class="{ loading: isPending(svc, 'stop') }"
                  @click="handleStop(svc)"
                >
                  {{ isPending(svc, 'stop') ? '\u2026' : 'Stop' }}
                </button>
                <button
                  v-else
                  class="btn-action btn-start"
                  :disabled="!!pendingAction"
                  :class="{ loading: isPending(svc, 'start') }"
                  @click="handleStart(svc)"
                >
                  {{ isPending(svc, 'start') ? '\u2026' : 'Start' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
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

.services-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}

.services-table th {
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

.service-row { border-bottom: 1px solid var(--border); transition: background 0.1s; }
.service-row:last-child { border-bottom: none; }
.service-row:hover { background: var(--surface); }
.service-row td { padding: 8px 12px; vertical-align: middle; }

.mono { font-family: var(--font-mono); }
.td-name { font-weight: 600; }
.td-uptime { color: var(--text-muted); white-space: nowrap; }
.td-image { color: var(--text-muted); max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.td-actions { display: flex; gap: 6px; align-items: center; }
.text-muted { color: var(--text-muted); }

.state-chip {
  display: inline-block;
  font-size: 11px;
  font-family: var(--font-mono);
  padding: 2px 6px;
  border-radius: 3px;
  border: 1px solid;
  white-space: nowrap;
}

.btn-action {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-muted);
  padding: 3px 9px;
  border-radius: var(--radius);
  font-size: 11px;
  cursor: pointer;
  transition: color 0.1s, border-color 0.1s, background 0.1s;
  white-space: nowrap;
}
.btn-action:disabled { opacity: 0.35; cursor: not-allowed; }
.btn-action.loading { opacity: 0.6; }

.btn-restart:hover:not(:disabled) { color: var(--accent); border-color: var(--accent); }
.btn-stop:hover:not(:disabled) { color: var(--red); border-color: var(--red); background: rgba(239, 68, 68, 0.08); }
.btn-start:hover:not(:disabled) { color: var(--green); border-color: var(--green); background: rgba(34, 197, 94, 0.08); }
</style>
