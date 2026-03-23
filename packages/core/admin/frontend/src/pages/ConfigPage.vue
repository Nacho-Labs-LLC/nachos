<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue';
import TOML from '@iarna/toml';
import { getConfig, putConfig, type ConfigResponse } from '../api/client.js';

type Tab = 'llm' | 'channels' | 'tools' | 'security' | 'dlp' | 'rate_limits' | 'audit_settings' | 'assistant';

const raw = ref<ConfigResponse | null>(null);
const loading = ref(true);
const saving = ref(false);
const toast = ref<{ msg: string; type: 'ok' | 'err' } | null>(null);
const activeTab = ref<Tab>('llm');
const editorContent = ref('');
const showRaw = ref(false);

// Parsed sections for form editing
const form = reactive({
  llm: {
    provider: '',
    model: '',
    temperature: 0.7,
    max_tokens: 4096,
    fallback_order: '',
    retry: { attempts: 3, min_delay_ms: 1000, max_delay_ms: 30000 },
  },
  security: { mode: 'standard' as 'strict' | 'standard' | 'permissive' },
  dlp: {
    enabled: false,
    action: 'block' as 'block' | 'warn' | 'audit' | 'allow' | 'redact',
    patterns: '',
  },
  rateLimits: {
    messages_per_minute: 0,
    tool_calls_per_minute: 0,
    llm_requests_per_minute: 0,
  },
  auditSettings: {
    enabled: false,
    retention_days: 90,
    log_inputs: true,
    log_outputs: true,
    log_tool_calls: true,
    provider: 'sqlite' as 'sqlite' | 'file' | 'webhook',
  },
  channels: {} as Record<string, { enabled: boolean }>,
  tools: {} as Record<string, { enabled: boolean }>,
  assistant: { name: '', system_prompt: '' },
});

const CHANNELS = ['webchat', 'slack', 'discord', 'telegram', 'whatsapp'];
const TOOLS = [
  { key: 'filesystem', label: 'Filesystem' },
  { key: 'browser', label: 'Browser' },
  { key: 'code_runner', label: 'Code Runner' },
  { key: 'shell', label: 'Shell (high risk)' },
  { key: 'web_fetch', label: 'Web Fetch' },
  { key: 'web_search', label: 'Web Search' },
  { key: 'bootstrap', label: 'Bootstrap' },
];

function hydrateForm(parsed: Record<string, unknown>) {
  const llm = (parsed['llm'] as Record<string, unknown>) ?? {};
  form.llm.provider = String(llm['provider'] ?? 'anthropic');
  form.llm.model = String(llm['model'] ?? '');
  form.llm.temperature = Number(llm['temperature'] ?? 0.7);
  form.llm.max_tokens = Number(llm['max_tokens'] ?? 4096);
  const fallback = llm['fallback_order'];
  form.llm.fallback_order = Array.isArray(fallback) ? fallback.join(', ') : '';
  const retry = (llm['retry'] as Record<string, unknown>) ?? {};
  form.llm.retry.attempts = Number(retry['attempts'] ?? 3);
  form.llm.retry.min_delay_ms = Number(retry['min_delay_ms'] ?? 1000);
  form.llm.retry.max_delay_ms = Number(retry['max_delay_ms'] ?? 30000);

  const sec = (parsed['security'] as Record<string, unknown>) ?? {};
  form.security.mode = (sec['mode'] as typeof form.security.mode) ?? 'standard';

  const dlp = (sec['dlp'] as Record<string, unknown>) ?? {};
  form.dlp.enabled = Boolean(dlp['enabled'] ?? false);
  form.dlp.action = (dlp['action'] as typeof form.dlp.action) ?? 'block';
  const patterns = dlp['patterns'];
  form.dlp.patterns = Array.isArray(patterns) ? patterns.join('\n') : '';

  const rateLimits = (sec['rate_limits'] as Record<string, unknown>) ?? {};
  form.rateLimits.messages_per_minute = Number(rateLimits['messages_per_minute'] ?? 0);
  form.rateLimits.tool_calls_per_minute = Number(rateLimits['tool_calls_per_minute'] ?? 0);
  form.rateLimits.llm_requests_per_minute = Number(rateLimits['llm_requests_per_minute'] ?? 0);

  const audit = (sec['audit'] as Record<string, unknown>) ?? {};
  form.auditSettings.enabled = Boolean(audit['enabled'] ?? false);
  form.auditSettings.retention_days = Number(audit['retention_days'] ?? 90);
  form.auditSettings.log_inputs = Boolean(audit['log_inputs'] ?? true);
  form.auditSettings.log_outputs = Boolean(audit['log_outputs'] ?? true);
  form.auditSettings.log_tool_calls = Boolean(audit['log_tool_calls'] ?? true);
  form.auditSettings.provider = (audit['provider'] as typeof form.auditSettings.provider) ?? 'sqlite';

  const channels = (parsed['channels'] as Record<string, Record<string, unknown>>) ?? {};
  for (const ch of CHANNELS) {
    form.channels[ch] = { enabled: Boolean(channels[ch]?.['enabled'] ?? false) };
  }

  const tools = (parsed['tools'] as Record<string, Record<string, unknown>>) ?? {};
  for (const { key } of TOOLS) {
    form.tools[key] = { enabled: Boolean(tools[key]?.['enabled'] ?? false) };
  }

  const assistant = (parsed['assistant'] as Record<string, unknown>) ?? {};
  form.assistant.name = String(assistant['name'] ?? 'Nachos');
  form.assistant.system_prompt = String(assistant['system_prompt'] ?? '');
}

async function load() {
  try {
    raw.value = await getConfig();
    editorContent.value = raw.value.content;
    hydrateForm(raw.value.parsed);
  } catch (e) {
    showToast(String(e), 'err');
  } finally {
    loading.value = false;
  }
}

async function save() {
  saving.value = true;
  try {
    const content = showRaw.value ? editorContent.value : buildToml();
    await putConfig(content);
    raw.value = await getConfig();
    editorContent.value = raw.value.content;
    hydrateForm(raw.value.parsed);
    showToast('Config saved', 'ok');
  } catch (e) {
    showToast(String(e), 'err');
  } finally {
    saving.value = false;
  }
}

function buildToml(): string {
  const parsed = TOML.parse(editorContent.value) as Record<string, unknown>;

  if (!parsed['llm']) parsed['llm'] = {};
  const llmObj = parsed['llm'] as Record<string, unknown>;
  Object.assign(llmObj, {
    provider: form.llm.provider,
    model: form.llm.model,
    temperature: form.llm.temperature,
    max_tokens: form.llm.max_tokens,
  });

  const fallbackArr = form.llm.fallback_order
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean);
  if (fallbackArr.length > 0) {
    llmObj['fallback_order'] = fallbackArr;
  } else {
    delete llmObj['fallback_order'];
  }

  if (!llmObj['retry']) llmObj['retry'] = {};
  Object.assign(llmObj['retry'] as object, {
    attempts: form.llm.retry.attempts,
    min_delay_ms: form.llm.retry.min_delay_ms,
    max_delay_ms: form.llm.retry.max_delay_ms,
  });

  if (!parsed['security']) parsed['security'] = {};
  const secObj = parsed['security'] as Record<string, unknown>;
  secObj['mode'] = form.security.mode;

  if (!secObj['dlp']) secObj['dlp'] = {};
  const dlpPatterns = form.dlp.patterns
    .split('\n')
    .map((s: string) => s.trim())
    .filter(Boolean);
  Object.assign(secObj['dlp'] as object, {
    enabled: form.dlp.enabled,
    action: form.dlp.action,
    patterns: dlpPatterns,
  });

  if (!secObj['rate_limits']) secObj['rate_limits'] = {};
  const rlObj = secObj['rate_limits'] as Record<string, unknown>;
  if (form.rateLimits.messages_per_minute > 0) {
    rlObj['messages_per_minute'] = form.rateLimits.messages_per_minute;
  } else {
    delete rlObj['messages_per_minute'];
  }
  if (form.rateLimits.tool_calls_per_minute > 0) {
    rlObj['tool_calls_per_minute'] = form.rateLimits.tool_calls_per_minute;
  } else {
    delete rlObj['tool_calls_per_minute'];
  }
  if (form.rateLimits.llm_requests_per_minute > 0) {
    rlObj['llm_requests_per_minute'] = form.rateLimits.llm_requests_per_minute;
  } else {
    delete rlObj['llm_requests_per_minute'];
  }

  if (!secObj['audit']) secObj['audit'] = {};
  Object.assign(secObj['audit'] as object, {
    enabled: form.auditSettings.enabled,
    retention_days: form.auditSettings.retention_days,
    log_inputs: form.auditSettings.log_inputs,
    log_outputs: form.auditSettings.log_outputs,
    log_tool_calls: form.auditSettings.log_tool_calls,
    provider: form.auditSettings.provider,
  });

  if (!parsed['channels']) parsed['channels'] = {};
  const channels = parsed['channels'] as Record<string, Record<string, unknown>>;
  for (const ch of CHANNELS) {
    if (!channels[ch]) channels[ch] = {};
    channels[ch]['enabled'] = form.channels[ch]?.enabled ?? false;
  }

  if (!parsed['tools']) parsed['tools'] = {};
  const tools = parsed['tools'] as Record<string, Record<string, unknown>>;
  for (const { key } of TOOLS) {
    if (!tools[key]) tools[key] = {};
    tools[key]['enabled'] = form.tools[key]?.enabled ?? false;
  }

  if (!parsed['assistant']) parsed['assistant'] = {};
  Object.assign(parsed['assistant'] as object, {
    name: form.assistant.name,
    system_prompt: form.assistant.system_prompt,
  });

  return TOML.stringify(parsed as TOML.JsonMap);
}

function showToast(msg: string, type: 'ok' | 'err') {
  toast.value = { msg, type };
  setTimeout(() => (toast.value = null), 3000);
}

const tabs: { key: Tab; label: string }[] = [
  { key: 'llm', label: 'LLM' },
  { key: 'channels', label: 'Channels' },
  { key: 'tools', label: 'Tools' },
  { key: 'security', label: 'Security' },
  { key: 'dlp', label: 'DLP' },
  { key: 'rate_limits', label: 'Rate Limits' },
  { key: 'audit_settings', label: 'Audit Settings' },
  { key: 'assistant', label: 'Assistant' },
];

const modeDesc = computed(() => {
  if (form.security.mode === 'strict') return 'All tools disabled; allowlist DMs; full audit.';
  if (form.security.mode === 'permissive') return 'Full access. Requires explicit opt-in.';
  return 'Common tools enabled; pairing DMs; balanced security.';
});

onMounted(() => void load());
</script>

<template>
  <div class="page config-page">
    <header class="page-header">
      <div>
        <h1 class="page-title">Configuration</h1>
        <p class="page-sub">Edit nachos.toml — changes are written to disk immediately</p>
      </div>
      <div class="header-actions">
        <div class="toggle-group">
          <label class="toggle-label">
            <input type="checkbox" v-model="showRaw" />
            Raw TOML
          </label>
          <span v-if="!showRaw" class="toggle-hint">
            Form mode strips comments on save — use Raw TOML to preserve them.
          </span>
        </div>
        <button class="btn-primary" :disabled="saving || loading" @click="save">
          {{ saving ? 'Saving…' : 'Save Config' }}
        </button>
      </div>
    </header>

    <div v-if="toast" class="toast" :class="toast.type === 'ok' ? 'toast-ok' : 'toast-err'">
      {{ toast.msg }}
    </div>

    <div v-if="loading" class="loading">Loading config…</div>

    <div v-else-if="showRaw" class="raw-editor">
      <textarea v-model="editorContent" class="toml-editor" spellcheck="false" />
    </div>

    <template v-else>
      <nav class="tab-bar">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="tab-btn"
          :class="{ active: activeTab === tab.key }"
          @click="activeTab = tab.key"
        >
          {{ tab.label }}
        </button>
      </nav>

      <!-- LLM -->
      <section v-if="activeTab === 'llm'" class="form-section">
        <div class="field">
          <label class="field-label">Provider</label>
          <select v-model="form.llm.provider" class="field-input">
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
            <option value="ollama">Ollama (local)</option>
            <option value="custom">Custom</option>
          </select>
        </div>

        <div class="field">
          <label class="field-label">Model</label>
          <input v-model="form.llm.model" type="text" class="field-input" placeholder="claude-sonnet-4-20250514" />
        </div>

        <div class="field">
          <label class="field-label">
            Temperature
            <span class="field-value">{{ form.llm.temperature.toFixed(2) }}</span>
          </label>
          <input v-model.number="form.llm.temperature" type="range" min="0" max="1" step="0.01" class="range-input" />
          <div class="range-labels"><span>Deterministic</span><span>Creative</span></div>
        </div>

        <div class="field">
          <label class="field-label">Max Tokens</label>
          <input v-model.number="form.llm.max_tokens" type="number" class="field-input" min="256" max="100000" step="256" />
        </div>

        <h3 class="subsection-title">Advanced</h3>

        <div class="field">
          <label class="field-label">Fallback Order</label>
          <input v-model="form.llm.fallback_order" type="text" class="field-input" placeholder="anthropic, openai, ollama" />
          <p class="field-hint">Comma-separated list of providers to try in order.</p>
        </div>

        <div class="field">
          <label class="field-label">Retry Attempts</label>
          <input v-model.number="form.llm.retry.attempts" type="number" class="field-input" min="0" max="10" step="1" />
        </div>

        <div class="field">
          <label class="field-label">Min Retry Delay (ms)</label>
          <input v-model.number="form.llm.retry.min_delay_ms" type="number" class="field-input" min="0" step="100" />
        </div>

        <div class="field">
          <label class="field-label">Max Retry Delay (ms)</label>
          <input v-model.number="form.llm.retry.max_delay_ms" type="number" class="field-input" min="0" step="100" />
        </div>
      </section>

      <!-- Channels -->
      <section v-if="activeTab === 'channels'" class="form-section">
        <p class="section-hint">Credentials are set via environment variables in your .env file.</p>
        <div class="toggle-list">
          <div v-for="ch in CHANNELS" :key="ch" class="toggle-row">
            <div class="toggle-info">
              <span class="toggle-name">{{ ch }}</span>
            </div>
            <label class="switch">
              <input type="checkbox" v-model="form.channels[ch].enabled" />
              <span class="switch-track" />
            </label>
          </div>
        </div>
      </section>

      <!-- Tools -->
      <section v-if="activeTab === 'tools'" class="form-section">
        <div class="toggle-list">
          <div v-for="tool in TOOLS" :key="tool.key" class="toggle-row">
            <div class="toggle-info">
              <span class="toggle-name">{{ tool.label }}</span>
              <span v-if="tool.key === 'shell'" class="badge-warn">high risk</span>
            </div>
            <label class="switch">
              <input type="checkbox" v-model="form.tools[tool.key].enabled" />
              <span class="switch-track" />
            </label>
          </div>
        </div>
      </section>

      <!-- Security -->
      <section v-if="activeTab === 'security'" class="form-section">
        <div class="field">
          <label class="field-label">Security Mode</label>
          <div class="radio-group">
            <label
              v-for="mode in ['strict', 'standard', 'permissive']"
              :key="mode"
              class="radio-option"
              :class="{ selected: form.security.mode === mode }"
            >
              <input type="radio" :value="mode" v-model="form.security.mode" />
              <span class="radio-label">{{ mode }}</span>
            </label>
          </div>
          <p class="field-hint">{{ modeDesc }}</p>
        </div>
      </section>

      <!-- DLP -->
      <section v-if="activeTab === 'dlp'" class="form-section">
        <div class="toggle-row">
          <div class="toggle-info">
            <span class="toggle-name">Enable DLP</span>
          </div>
          <label class="switch">
            <input type="checkbox" v-model="form.dlp.enabled" />
            <span class="switch-track" />
          </label>
        </div>

        <div class="field">
          <label class="field-label">Action</label>
          <select v-model="form.dlp.action" class="field-input">
            <option value="block">Block</option>
            <option value="warn">Warn</option>
            <option value="audit">Audit</option>
            <option value="allow">Allow</option>
            <option value="redact">Redact</option>
          </select>
        </div>

        <div class="field">
          <label class="field-label">Patterns</label>
          <textarea v-model="form.dlp.patterns" class="field-textarea" rows="6" placeholder="One regex pattern per line" />
          <p class="field-hint">One regex pattern per line. Matched content triggers the selected action.</p>
        </div>
      </section>

      <!-- Rate Limits -->
      <section v-if="activeTab === 'rate_limits'" class="form-section">
        <div class="field">
          <label class="field-label">Messages per Minute</label>
          <input v-model.number="form.rateLimits.messages_per_minute" type="number" class="field-input" min="0" step="1" />
          <p class="field-hint">0 = unlimited</p>
        </div>

        <div class="field">
          <label class="field-label">Tool Calls per Minute</label>
          <input v-model.number="form.rateLimits.tool_calls_per_minute" type="number" class="field-input" min="0" step="1" />
          <p class="field-hint">0 = unlimited</p>
        </div>

        <div class="field">
          <label class="field-label">LLM Requests per Minute</label>
          <input v-model.number="form.rateLimits.llm_requests_per_minute" type="number" class="field-input" min="0" step="1" />
          <p class="field-hint">0 = unlimited</p>
        </div>
      </section>

      <!-- Audit Settings -->
      <section v-if="activeTab === 'audit_settings'" class="form-section">
        <div class="toggle-row">
          <div class="toggle-info">
            <span class="toggle-name">Enable Audit Logging</span>
          </div>
          <label class="switch">
            <input type="checkbox" v-model="form.auditSettings.enabled" />
            <span class="switch-track" />
          </label>
        </div>

        <div class="field">
          <label class="field-label">Retention (days)</label>
          <input v-model.number="form.auditSettings.retention_days" type="number" class="field-input" min="1" step="1" />
        </div>

        <div class="toggle-row">
          <div class="toggle-info">
            <span class="toggle-name">Log Inputs</span>
          </div>
          <label class="switch">
            <input type="checkbox" v-model="form.auditSettings.log_inputs" />
            <span class="switch-track" />
          </label>
        </div>

        <div class="toggle-row">
          <div class="toggle-info">
            <span class="toggle-name">Log Outputs</span>
          </div>
          <label class="switch">
            <input type="checkbox" v-model="form.auditSettings.log_outputs" />
            <span class="switch-track" />
          </label>
        </div>

        <div class="toggle-row">
          <div class="toggle-info">
            <span class="toggle-name">Log Tool Calls</span>
          </div>
          <label class="switch">
            <input type="checkbox" v-model="form.auditSettings.log_tool_calls" />
            <span class="switch-track" />
          </label>
        </div>

        <div class="field">
          <label class="field-label">Provider</label>
          <select v-model="form.auditSettings.provider" class="field-input">
            <option value="sqlite">SQLite</option>
            <option value="file">File</option>
            <option value="webhook">Webhook</option>
          </select>
        </div>
      </section>

      <!-- Assistant -->
      <section v-if="activeTab === 'assistant'" class="form-section">
        <div class="field">
          <label class="field-label">Name</label>
          <input v-model="form.assistant.name" type="text" class="field-input" placeholder="Nachos" />
        </div>

        <div class="field">
          <label class="field-label">System Prompt</label>
          <textarea v-model="form.assistant.system_prompt" class="field-textarea" rows="8" placeholder="You are a helpful AI assistant…" />
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.config-page {
  max-width: 760px;
}

.toggle-group {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.toggle-hint {
  font-size: 11px;
  color: var(--text-faint);
  max-width: 220px;
  text-align: right;
  line-height: 1.4;
}

.toggle-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-muted);
  cursor: pointer;
}

.toggle-label input {
  cursor: pointer;
  accent-color: var(--accent);
}

.raw-editor {
  height: calc(100vh - 160px);
}

.toml-editor {
  width: 100%;
  height: 100%;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.6;
  padding: 16px;
  resize: none;
  outline: none;
  tab-size: 2;
  transition: border-color var(--duration-fast) var(--ease-out);
}

.toml-editor:focus {
  border-color: var(--accent);
  box-shadow: var(--focus-ring);
}

.range-input {
  width: 100%;
  accent-color: var(--accent);
}

.range-labels {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-faint);
}
</style>
