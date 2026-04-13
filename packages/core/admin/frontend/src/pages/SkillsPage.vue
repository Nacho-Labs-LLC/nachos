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
  if (status === 'active') return 'var(--ok)';
  if (status === 'unavailable') return 'var(--warning, #e6a700)';
  if (status === 'denied') return 'var(--danger)';
  if (status === 'disabled') return 'var(--text-muted)';
  return 'var(--text-muted)';
}

onMounted(() => {
  void load();
});
</script>

<template>
  <div class="page skills-page">
    <header class="page-header">
      <div>
        <h1 class="page-title">Skills</h1>
        <p v-if="data" class="page-sub">
          {{ data.skills.length }} skill{{ data.skills.length !== 1 ? 's' : '' }}
        </p>
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
          class="card skill-card"
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
            Homepage ↗
          </a>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.skills-page {
  max-width: 1100px;
}

.skill-card {
  min-width: 220px;
  flex: 1;
  max-width: 340px;
}

.card-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.card-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-strong);
}

.card-desc {
  font-size: 13px;
  color: var(--text-muted);
  line-height: 1.4;
  margin-bottom: 8px;
}

.card-reason {
  font-size: 11px;
  color: var(--text-faint);
  font-style: italic;
  margin-bottom: 8px;
}

.card-link {
  font-size: 12px;
  color: var(--accent);
  transition: opacity var(--duration-fast) var(--ease-out);
}

.card-link:hover {
  opacity: 0.8;
}
</style>
