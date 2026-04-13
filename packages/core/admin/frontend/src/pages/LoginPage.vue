<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const token = ref('');
const error = ref('');
const loading = ref(false);

async function handleLogin() {
  error.value = '';
  const trimmed = token.value.trim();
  if (!trimmed) {
    error.value = 'Token is required';
    return;
  }

  loading.value = true;
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: trimmed }),
    });

    if (!res.ok) {
      error.value = 'Invalid token';
      return;
    }

    router.push('/status');
  } catch {
    error.value = 'Connection failed';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login-shell">
    <form class="login-card" @submit.prevent="handleLogin">
      <div class="login-brand">
        <span class="login-icon">🧀</span>
        <span class="login-title">Nachos Admin</span>
      </div>

      <label class="login-label" for="token">Admin Token</label>
      <input
        id="token"
        v-model="token"
        type="password"
        class="login-input"
        placeholder="Paste your NACHOS_ADMIN_TOKEN"
        autocomplete="off"
        autofocus
      />

      <p v-if="error" class="login-error">{{ error }}</p>

      <button type="submit" class="login-btn" :disabled="loading">
        {{ loading ? 'Authenticating...' : 'Log in' }}
      </button>
    </form>
  </div>
</template>

<style scoped>
.login-shell {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  background: var(--bg);
}

.login-card {
  width: 360px;
  padding: 32px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.login-brand {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 8px;
}

.login-icon {
  font-size: 20px;
}

.login-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-strong);
  letter-spacing: -0.3px;
}

.login-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.login-input {
  padding: 10px 12px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  font-size: 14px;
  font-family: var(--font-mono);
  transition: border-color var(--duration-fast) var(--ease-out);
}

.login-input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-dim);
}

.login-error {
  font-size: 13px;
  color: var(--danger);
  margin: -4px 0;
}

.login-btn {
  padding: 10px 16px;
  background: var(--accent);
  color: var(--accent-foreground);
  border: none;
  border-radius: var(--radius);
  font-size: 14px;
  font-weight: 600;
  transition:
    background var(--duration-fast) var(--ease-out),
    opacity var(--duration-fast) var(--ease-out);
}

.login-btn:hover:not(:disabled) {
  background: var(--accent-hover);
}

.login-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
