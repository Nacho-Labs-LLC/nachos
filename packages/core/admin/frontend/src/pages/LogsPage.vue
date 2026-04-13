<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue';

const SERVICES = [
  'gateway',
  'bus',
  'slack',
  'discord',
  'telegram',
  'whatsapp',
  'llm-proxy',
  'admin',
] as const;

type ServiceName = (typeof SERVICES)[number];

const selectedService = ref<ServiceName>('gateway');
const lines = ref<string[]>([]);
const paused = ref(false);
const logContainer = ref<HTMLElement | null>(null);

let es: EventSource | null = null;

const MAX_LINES = 1000;

function scrollToBottom() {
  nextTick(() => {
    if (logContainer.value) {
      logContainer.value.scrollTop = logContainer.value.scrollHeight;
    }
  });
}

function connect(service: ServiceName) {
  if (es) {
    es.close();
    es = null;
  }
  if (paused.value) return;

  const source = new EventSource(`/api/logs/${service}`);

  source.onmessage = (event: MessageEvent<string>) => {
    const line = (event.data as string).replace(/\\n/g, '\n');
    lines.value.push(line);
    if (lines.value.length > MAX_LINES) {
      lines.value = lines.value.slice(lines.value.length - MAX_LINES);
    }
    scrollToBottom();
  };

  source.onerror = () => {
    // EventSource will auto-reconnect
  };

  es = source;
}

function disconnect() {
  if (es) {
    es.close();
    es = null;
  }
}

function togglePause() {
  paused.value = !paused.value;
  if (paused.value) {
    disconnect();
  } else {
    connect(selectedService.value);
  }
}

function clearLog() {
  lines.value = [];
}

watch(selectedService, (svc) => {
  lines.value = [];
  if (!paused.value) {
    connect(svc);
  }
});

onMounted(() => {
  connect(selectedService.value);
});

onUnmounted(() => {
  disconnect();
});
</script>

<template>
  <div class="page logs-page">
    <header class="page-header">
      <div>
        <h1 class="page-title">Logs</h1>
        <p class="page-sub">Live container log stream</p>
      </div>
      <div class="header-actions">
        <button class="btn-ghost" @click="clearLog">Clear</button>
        <button class="btn-ghost" :class="{ 'btn-paused': paused }" @click="togglePause">
          {{ paused ? '\u25B6 Resume' : '\u23F8 Pause' }}
        </button>
      </div>
    </header>

    <!-- Service selector tabs -->
    <div class="service-tabs">
      <button
        v-for="svc in SERVICES"
        :key="svc"
        class="svc-tab"
        :class="{ active: selectedService === svc }"
        @click="selectedService = svc"
      >
        {{ svc }}
      </button>
    </div>

    <!-- Status indicator -->
    <div class="status-bar">
      <span class="status-dot" :class="paused ? 'dot-paused' : 'dot-live'" />
      <span class="status-label">{{ paused ? 'Paused' : 'Live' }}</span>
      <span class="line-count">{{ lines.length.toLocaleString() }} lines</span>
    </div>

    <!-- Log output -->
    <div ref="logContainer" class="log-output">
      <div v-if="lines.length === 0" class="log-empty">
        {{ paused ? 'Paused \u2014 press Resume to stream logs.' : 'Waiting for log output\u2026' }}
      </div>
      <div v-for="(line, i) in lines" :key="i" class="log-line">{{ line }}</div>
    </div>
  </div>
</template>

<style scoped>
.logs-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  box-sizing: border-box;
}

.logs-page .page-header {
  flex-shrink: 0;
}

.btn-paused {
  color: var(--accent);
  border-color: var(--accent);
}

.btn-paused:hover {
  color: var(--accent);
}

.service-tabs {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  margin-bottom: 12px;
  flex-shrink: 0;
}

.svc-tab {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-muted);
  padding: 6px 12px;
  border-radius: var(--radius);
  font-size: 12px;
  font-family: var(--font-mono);
  cursor: pointer;
  transition:
    color var(--duration-fast) var(--ease-out),
    background var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out);
}

.svc-tab:hover {
  color: var(--text);
  background: var(--bg-hover);
}

.svc-tab.active {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-dim);
}

.status-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  flex-shrink: 0;
}

.dot-live {
  background: var(--ok);
  box-shadow: 0 0 6px var(--ok);
}

.dot-paused {
  background: var(--text-muted);
}

.status-label {
  font-size: 12px;
  color: var(--text-muted);
}

.line-count {
  margin-left: auto;
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--text-faint);
}

.log-output {
  flex: 1;
  min-height: 0;
  height: 500px;
  max-height: 500px;
  overflow-y: auto;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px 16px;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.55;
  color: var(--text);
  box-shadow: var(--shadow-inset);
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}

.log-empty {
  color: var(--text-muted);
  font-style: italic;
}

.log-line {
  white-space: pre-wrap;
  word-break: break-all;
  padding: 1px 0;
}

.log-line:hover {
  background: var(--bg-hover);
}
</style>
