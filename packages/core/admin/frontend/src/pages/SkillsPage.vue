<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { getSkills, type SkillEntry, type SkillsResponse } from '../api/client.js';

const data = ref<SkillsResponse | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

async function load() {
  loading.value = true;
  try {
    data.value = await getSkills();
    error.value = null;
  } catch (e) {
    error.value = String(e);
  } finally {
    loading.value = false;
  }
}

function statusColor(status: string): string {
  if (status === 'active') return 'var(--green)';
  if (status === 'denied') return 'var(--red)';
  if (status === 'disabled') return 'var(--text-muted)';
  return 'var(--text-muted)';
}

onMounted(() => {
  void load();
});
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <h1 class="page-title">Skills</h1>
        <p v-if="data" class="page-sub">{{ data.skills.length }} skill{{ data.skills.length !== 1 ? 's' : '' }}</p>
      </div>
      <button class="btn-ghost" :disabled="loading" @click="load">
        {{ loading ? 'Loading\u2026' : '\u21BB Refresh' }}
      </button>
    </header>

    <div v-if="error" class="alert-error">{{ error }}</div>

    <div v-if="loading && !data" class="loading">Loading\u2026</div>

    <template v-if="data">
      <div v-if="data.skills.length === 0" class="empty">
        No skills found. Skills directory may not be mounted.
      </div>

      <div v-else class="card-grid">
        <div
          v-for="skill in data.skills"
          :key="skill.name"
          class="card"
          :class="{ 'card-disabled': skill.status !== 'active' }"
        >
          <div class="card-top">
            <div class="card-name">{{ skill.name }}</div>
            <span
              class="status-chip"
              :style="{ color: statusColor(skill.status), borderColor: statusColor(skill.status) }"
            >
              {{ skill.status }}
            </span>
          </div>
          <p class="card-desc">{{ skill.description || 'No description' }}</p>
          <p v-if="skill.reason" class="card-reason">{{ skill.reason }}</p>
          <a
            v-if="skill.homepage"
            :href="skill.homepage"
            class="card-link"
            target="_blank"
            rel="noopener"
          >
            Homepage \u2197
          </a>
        </div>
      </div>
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
  margin-bottom: 20px;
  font-size: 13px;
}

.loading, .empty { color: var(--text-muted); font-size: 13px; }

.card-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px;
  min-width: 220px;
  flex: 1;
  max-width: 340px;
}

.card-disabled { opacity: 0.5; }

.card-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.card-name {
  font-size: 14px;
  font-weight: 600;
}

.status-chip {
  display: inline-block;
  font-size: 11px;
  font-family: var(--font-mono);
  padding: 2px 6px;
  border-radius: 3px;
  border: 1px solid;
  white-space: nowrap;
}

.card-desc {
  font-size: 12.5px;
  color: var(--text-muted);
  line-height: 1.4;
  margin-bottom: 6px;
}

.card-reason {
  font-size: 11px;
  color: var(--text-muted);
  font-style: italic;
  margin-bottom: 6px;
}

.card-link {
  font-size: 12px;
  color: var(--accent);
  transition: opacity 0.1s;
}
.card-link:hover { opacity: 0.8; }
</style>
