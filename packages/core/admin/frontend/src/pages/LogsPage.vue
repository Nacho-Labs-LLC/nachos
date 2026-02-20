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
    // Trim to max line limit
    if (lines.value.length > MAX_LINES) {
      lines.value = lines.value.slice(lines.value.length - MAX_LINES);
    }
    scrollToBottom();
  };

  source.onerror = () => {
    // EventSource will auto-reconnect; no action needed
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

// Reconnect when service changes
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
  <div class="page">
    <header class="page-header">
      <div>
        <h1 class="page-title">Logs</h1>
        <p class="page-sub">Live container log stream</p>
      </div>
      <div class="header-actions">
        <button class="btn-ghost" @click="clearLog">Clear</button>
        <button
          class="btn-ghost"
          :class="{ 'btn-paused': paused }"
          @click="togglePause"
        >
          {{ paused ? '\u25B6 Resume' : '\u23F8 Pause' }}
        </button>
      </div>
    </header>

    <!-- Service selector tabs -->
    <div class="service-tabs">
      <button
        v-for="svc in SERVICES"
        :key="svc"
        class="tab-btn"
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
.page { padding: 28px 32px; display: flex; flex-direction: column; height: 100%; box-sizing: border-box; }

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 16px;
  flex-shrink: 0;
}

.page-title { font-size: 20px; font-weight: 700; letter-spacing: -0.4px; }
.page-sub { font-size: 12px; color: var(--text-muted); margin-top: 3px; }

.header-actions { display: flex; gap: 8px; align-items: center; }

.btn-ghost {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-muted);
  padding: 6px 12px;
  border-radius: var(--radius);
  font-size: 13px;
  cursor: pointer;
  transition: color 0.1s, border-color 0.1s;
}
.btn-ghost:hover { color: var(--text); border-color: var(--text-muted); }
.btn-paused { color: var(--accent); border-color: var(--accent); }
.btn-paused:hover { color: var(--accent); }

.service-tabs {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  margin-bottom: 12px;
  flex-shrink: 0;
}

.tab-btn {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-muted);
  padding: 5px 11px;
  border-radius: var(--radius);
  font-size: 12px;
  font-family: var(--font-mono);
  cursor: pointer;
  transition: color 0.1s, background 0.1s, border-color 0.1s;
}
.tab-btn:hover { color: var(--text); background: var(--surface); }
.tab-btn.active {
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

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.dot-live { background: var(--green); box-shadow: 0 0 4px var(--green); }
.dot-paused { background: var(--text-muted); }

.status-label { font-size: 12px; color: var(--text-muted); }

.line-count {
  margin-left: auto;
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--text-muted);
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
  padding: 10px 14px;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.55;
  color: var(--text);
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

.log-line:hover { background: rgba(255,255,255,0.03); }
</style>
