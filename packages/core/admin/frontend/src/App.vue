<script setup lang="ts">
import { RouterView, RouterLink, useRoute } from 'vue-router';
import { computed, ref, onMounted } from 'vue';

const route = useRoute();
const currentPath = computed(() => route.path);

const theme = ref<'dark' | 'light'>('dark');

function toggleTheme() {
  theme.value = theme.value === 'dark' ? 'light' : 'dark';
  if (theme.value === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  localStorage.setItem('nachos-theme', theme.value);
}

onMounted(() => {
  const saved = localStorage.getItem('nachos-theme') as 'dark' | 'light' | null;
  if (saved === 'light') {
    theme.value = 'light';
    document.documentElement.setAttribute('data-theme', 'light');
  }
});
</script>

<template>
  <div class="shell">
    <nav class="sidebar">
      <div class="brand">
        <span class="brand-icon">🧀</span>
        <span class="brand-name">Nachos</span>
        <span class="brand-label">Admin</span>
      </div>

      <ul class="nav-list">
        <li>
          <RouterLink
            to="/status"
            class="nav-link"
            :class="{ active: currentPath === '/status' }"
          >
            <span class="nav-icon">◈</span>
            Status
          </RouterLink>
        </li>
        <li>
          <RouterLink
            to="/config"
            class="nav-link"
            :class="{ active: currentPath === '/config' }"
          >
            <span class="nav-icon">◎</span>
            Config
          </RouterLink>
        </li>
        <li>
          <RouterLink
            to="/audit"
            class="nav-link"
            :class="{ active: currentPath === '/audit' }"
          >
            <span class="nav-icon">◷</span>
            Audit Log
          </RouterLink>
        </li>
        <li>
          <RouterLink
            to="/sessions"
            class="nav-link"
            :class="{ active: currentPath === '/sessions' }"
          >
            <span class="nav-icon">◉</span>
            Sessions
          </RouterLink>
        </li>
        <li>
          <RouterLink
            to="/skills"
            class="nav-link"
            :class="{ active: currentPath === '/skills' }"
          >
            <span class="nav-icon">◈</span>
            Skills
          </RouterLink>
        </li>
        <li>
          <RouterLink
            to="/services"
            class="nav-link"
            :class="{ active: currentPath === '/services' }"
          >
            <span class="nav-icon">▣</span>
            Services
          </RouterLink>
        </li>
        <li>
          <RouterLink
            to="/logs"
            class="nav-link"
            :class="{ active: currentPath === '/logs' }"
          >
            <span class="nav-icon">≡</span>
            Logs
          </RouterLink>
        </li>
      </ul>

      <div class="sidebar-footer">
        <button class="theme-btn" @click="toggleTheme" :title="theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'">
          {{ theme === 'dark' ? '☀' : '☾' }}
        </button>
        <a href="https://github.com/nachos-dev" class="doc-link" target="_blank" rel="noopener">
          Docs ↗
        </a>
      </div>
    </nav>

    <main class="content">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

.sidebar {
  width: 196px;
  min-width: 196px;
  background: var(--surface);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
}

.brand {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 20px 16px 16px;
  border-bottom: 1px solid var(--border);
}

.brand-icon { font-size: 16px; }
.brand-name { font-weight: 700; font-size: 15px; letter-spacing: -0.3px; color: var(--text-strong); }
.brand-label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--accent);
  background: var(--accent-dim);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
}

.nav-list {
  list-style: none;
  padding: 12px 8px;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-link {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: var(--radius);
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 500;
  transition:
    color var(--duration-fast) var(--ease-out),
    background var(--duration-fast) var(--ease-out);
}

.nav-link:hover {
  color: var(--text);
  background: var(--surface-2);
}

.nav-link.active {
  color: var(--text-strong);
  background: var(--surface-2);
}

.nav-link.active .nav-icon {
  color: var(--accent);
}

.nav-icon {
  font-size: 12px;
  color: var(--text-faint);
}

.sidebar-footer {
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.theme-btn {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-muted);
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  cursor: pointer;
  transition:
    color var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out);
}

.theme-btn:hover {
  color: var(--accent);
  border-color: var(--accent);
}

.doc-link {
  font-size: 12px;
  color: var(--text-muted);
  transition: color var(--duration-fast) var(--ease-out);
}

.doc-link:hover {
  color: var(--text);
}

.content {
  flex: 1;
  overflow-y: auto;
  background: var(--bg);
}
</style>
