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
const pendingAction = ref<string | null>(null);
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
  if (state === 'running') return 'var(--ok)';
  if (state === 'paused') return 'var(--warn)';
  if (state === 'restarting') return 'var(--warn)';
  return 'var(--danger)';
}

function healthColor(health: string): string {
  if (health === 'healthy') return 'var(--ok)';
  if (health === 'unhealthy') return 'var(--danger)';
  if (health === 'starting') return 'var(--warn)';
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
        <table class="data-table">
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
            <tr v-for="svc in data.services" :key="svc.name">
              <td class="mono td-name">{{ svc.name }}</td>
              <td>
                <span
                  class="status-chip"
                  :style="{ color: stateColor(svc.state), borderColor: stateColor(svc.state) }"
                >
                  {{ svc.state }}
                </span>
              </td>
              <td>
                <span
                  v-if="svc.health !== 'none'"
                  class="status-chip"
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
.td-name {
  font-weight: 600;
}
.td-uptime {
  color: var(--text-muted);
  white-space: nowrap;
}
.td-image {
  color: var(--text-muted);
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.td-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.btn-restart:hover:not(:disabled) {
  color: var(--accent);
  border-color: var(--accent);
}
.btn-stop:hover:not(:disabled) {
  color: var(--danger);
  border-color: var(--danger);
  background: var(--danger-subtle);
}
.btn-start:hover:not(:disabled) {
  color: var(--ok);
  border-color: var(--ok);
  background: var(--ok-subtle);
}
</style>
