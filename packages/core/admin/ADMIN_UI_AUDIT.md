# Admin UI UX Audit

**Date:** 2026-02-22  
**Auditor:** Claw (Orchestrator)  
**Target:** Nachos Admin UI (Vue 3 frontend)

---

## Executive Summary

**Overall Quality:** ⭐⭐⭐⭐☆ (4/5) - Surprisingly polished!

The Nachos Admin UI is **well-designed and functional**. It demonstrates:
- Clean, modern aesthetic
- Consistent design patterns
- Good component organization
- Thoughtful color usage (status indicators, etc.)

**Primary findings:**
1. ✅ **Strong foundation** - No critical UX issues
2. ⚠️ **Missing accessibility features** - Needs ARIA labels, keyboard nav, screen reader support
3. ⚠️ **No error boundaries** - Crashes propagate to entire app
4. ⚠️ **Limited mobile responsiveness** - Sidebar doesn't adapt
5. 💡 **Enhancement opportunities** - Loading skeletons, better empty states, dark mode

**Recommendation:** Focus on accessibility compliance and progressive enhancement, not major redesign.

---

## Architecture Overview

```
packages/core/admin/
├── frontend/              # Vue 3 SPA
│   ├── src/
│   │   ├── App.vue       # Shell with sidebar navigation
│   │   ├── pages/        # 7 main pages (Status, Config, Audit, Sessions, Skills, Services, Logs)
│   │   ├── api/          # API client
│   │   └── router.ts     # Vue Router config
│   ├── index.html
│   └── vite.config.ts
└── src/                  # Express backend API
    ├── server.ts
    ├── routes/           # API endpoints
    └── middleware/
```

**Tech stack:**
- Vue 3 (Composition API)
- Vue Router
- Vite
- TypeScript
- Custom CSS (CSS variables for theming)

---

## Page-by-Page Analysis

### 1. Status Page (`StatusPage.vue`) ⭐⭐⭐⭐☆

**Strengths:**
- ✅ Auto-refresh every 30s
- ✅ Clear visual hierarchy (top cards, then channels, then tools)
- ✅ Color-coded status indicators (green/yellow/red)
- ✅ Formatted uptime display
- ✅ Gateway health checks displayed

**Issues:**
- ⚠️ No loading skeleton (just "Loading…" text)
- ⚠️ Error state is basic (no retry button)
- ⚠️ Refresh button doesn't show progress
- ⚠️ No ARIA labels for status dots

**Improvements:**
```vue
<!-- Add skeleton loader -->
<div v-if="loading && !data" class="skeleton-grid">
  <div class="skeleton-card"></div>
  <div class="skeleton-card"></div>
  <div class="skeleton-card"></div>
</div>

<!-- Better refresh button -->
<button
  class="btn-ghost"
  :disabled="loading"
  @click="refresh"
  :aria-label="loading ? 'Refreshing status' : 'Refresh status'"
>
  <span :class="{ spinning: loading }">↻</span>
  {{ loading ? 'Refreshing…' : 'Refresh' }}
</button>

<!-- Accessible status indicators -->
<span
  class="status-dot"
  :style="{ background: statusColor(data.gateway.status) }"
  role="status"
  :aria-label="`Gateway status: ${data.gateway.status}`"
/>
```

---

### 2. Config Page (`ConfigPage.vue`) ⭐⭐⭐⭐☆

**Strengths:**
- ✅ JSON editor with syntax highlighting
- ✅ Save/reset functionality
- ✅ Validation before save

**Issues:**
- ⚠️ No "unsaved changes" warning
- ⚠️ No keyboard shortcuts (Cmd+S to save)
- ⚠️ Validation errors not inline
- ⚠️ No diff view when editing

**Improvements:**
```typescript
// Add unsaved changes guard
const hasUnsavedChanges = computed(() => 
  JSON.stringify(editedConfig.value) !== JSON.stringify(originalConfig.value)
);

// Keyboard shortcut
onMounted(() => {
  document.addEventListener('keydown', handleKeyDown);
});

function handleKeyDown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault();
    void save();
  }
}

// Warn before leaving
onBeforeRouteLeave((to, from, next) => {
  if (hasUnsavedChanges.value) {
    const answer = confirm('You have unsaved changes. Leave anyway?');
    next(answer);
  } else {
    next();
  }
});
```

---

### 3. Sessions Page, Audit Page, etc.

**Common patterns (strengths):**
- ✅ Table-based layouts with consistent styling
- ✅ Filtering and search functionality
- ✅ Pagination for large datasets
- ✅ Clear visual feedback for actions

**Common issues:**
- ⚠️ Tables not keyboard-navigable
- ⚠️ No column sorting
- ⚠️ No bulk actions
- ⚠️ Empty states are text-only (no illustrations)

---

## Accessibility Audit (WCAG 2.1)

### ❌ Level A Failures

1. **Missing ARIA labels**
   - Status dots have no `aria-label`
   - Icon buttons have no accessible names
   - Loading states not announced

2. **Keyboard navigation incomplete**
   - Tables can't be navigated with arrow keys
   - Modal dialogs (if any) don't trap focus
   - No visible focus indicators on some elements

3. **Form labels missing**
   - Some inputs lack explicit `<label>` associations

### ⚠️ Level AA Gaps

1. **Color contrast**
   - Some muted text may fail 4.5:1 ratio
   - Need to audit all text/background combinations

2. **Touch targets**
   - Some buttons < 44×44px minimum
   - Row click targets in tables unclear

3. **Responsive design**
   - Sidebar doesn't collapse on mobile
   - Tables overflow on small screens

---

## Mobile Responsiveness

**Current state:** Desktop-first, limited mobile support

**Issues:**
- 196px fixed sidebar doesn't adapt
- No hamburger menu for navigation
- Tables scroll horizontally (ok) but no sticky headers
- Touch targets sometimes too small

**Recommended breakpoints:**
```css
/* Current: desktop only */
.sidebar { width: 196px; }

/* Needed: */
@media (max-width: 768px) {
  .sidebar {
    position: fixed;
    left: 0;
    top: 0;
    transform: translateX(-100%);
    transition: transform 0.2s;
    z-index: 100;
  }
  
  .sidebar.open {
    transform: translateX(0);
  }
  
  .hamburger {
    display: block; /* Show mobile menu button */
  }
}

@media (min-width: 769px) {
  .hamburger {
    display: none;
  }
}
```

---

## Error Handling

**Current:**
- Error strings displayed in red boxes
- No retry mechanisms
- No error boundaries (Vue crashes propagate)

**Recommendations:**

```vue
<!-- App.vue - Add error boundary -->
<script setup lang="ts">
import { provide, ref } from 'vue';

const globalError = ref<Error | null>(null);

provide('handleError', (error: Error) => {
  globalError.value = error;
  console.error('Caught error:', error);
});
</script>

<template>
  <div v-if="globalError" class="error-boundary">
    <h2>Something went wrong</h2>
    <p>{{ globalError.message }}</p>
    <button @click="() => { globalError = null; location.reload(); }">
      Reload Page
    </button>
  </div>
  <div v-else class="shell">
    <!-- normal content -->
  </div>
</template>
```

```vue
<!-- StatusPage.vue - Better error handling -->
<div v-if="error" class="alert-error">
  <div class="alert-header">
    <span class="alert-icon">⚠️</span>
    <span>Failed to load status</span>
  </div>
  <div class="alert-body">{{ error }}</div>
  <button class="btn-sm" @click="refresh">Try Again</button>
</div>
```

---

## Loading States

**Current:** Simple text ("Loading…")

**Recommendation:** Skeleton loaders

```vue
<template>
  <div v-if="loading && !data" class="skeleton">
    <div class="skeleton-header">
      <div class="skeleton-title"></div>
      <div class="skeleton-button"></div>
    </div>
    <div class="skeleton-cards">
      <div class="skeleton-card"></div>
      <div class="skeleton-card"></div>
      <div class="skeleton-card"></div>
    </div>
  </div>
</template>

<style>
.skeleton-title {
  height: 24px;
  width: 200px;
  background: linear-gradient(90deg, var(--surface-2) 25%, var(--surface-3) 50%, var(--surface-2) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 4px;
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
</style>
```

---

## Dark Mode

**Current:** Uses CSS variables, but no dark mode toggle

**Theme system present:**
```css
:root {
  --bg: #fafafa;
  --surface: #ffffff;
  --text: #171717;
  --accent: #0ea5e9;
  /* ... */
}
```

**Recommendation:** Add dark mode

```vue
<!-- App.vue -->
<script setup>
import { ref, watch } from 'vue';

const theme = ref(localStorage.getItem('theme') || 'light');

watch(theme, (newTheme) => {
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('theme', newTheme);
});
</script>

<template>
  <button @click="theme = theme === 'light' ? 'dark' : 'light'" class="theme-toggle">
    {{ theme === 'light' ? '🌙' : '☀️' }}
  </button>
</template>
```

```css
/* styles.css */
:root {
  /* light mode (default) */
  --bg: #fafafa;
  --surface: #ffffff;
  --text: #171717;
}

[data-theme="dark"] {
  --bg: #0a0a0a;
  --surface: #171717;
  --text: #fafafa;
}
```

---

## Prioritized Improvements

### 🔴 High Priority (Accessibility & Stability)

1. **Add ARIA labels to all interactive elements** (2 hours)
   - Status indicators
   - Icon buttons
   - Navigation links

2. **Implement error boundaries** (1 hour)
   - Prevent full app crashes
   - Graceful error recovery

3. **Add keyboard navigation** (3 hours)
   - Table navigation with arrow keys
   - Keyboard shortcuts (Cmd+S, Esc, etc.)
   - Focus management in modals

4. **Mobile responsive sidebar** (2 hours)
   - Hamburger menu
   - Collapsible navigation
   - Touch-friendly targets

### 🟡 Medium Priority (UX Enhancement)

5. **Loading skeletons** (2 hours)
   - Replace "Loading…" text
   - Smooth content transitions

6. **Better error states** (1 hour)
   - Retry buttons
   - Helpful error messages
   - Network status indicator

7. **Unsaved changes warnings** (1 hour)
   - Config page guard
   - Visual indicator of dirty state

8. **Dark mode** (2 hours)
   - Theme toggle
   - Persistent preference
   - Smooth transitions

### 🟢 Low Priority (Nice-to-Have)

9. **Column sorting in tables** (2 hours)
10. **Bulk actions** (3 hours)
11. **Advanced filtering** (3 hours)
12. **Keyboard shortcuts overlay** (1 hour - show Cmd+K to list shortcuts)

---

## Testing Checklist

### Accessibility
- [ ] Run axe DevTools audit
- [ ] Test with screen reader (NVDA/VoiceOver)
- [ ] Keyboard-only navigation
- [ ] Color contrast check (all text)
- [ ] Touch target sizes (mobile)

### Browser Compatibility
- [ ] Chrome/Edge (modern)
- [ ] Firefox
- [ ] Safari (Mac + iOS)
- [ ] Mobile browsers

### Responsive
- [ ] Desktop (1920×1080)
- [ ] Laptop (1366×768)
- [ ] Tablet (768×1024)
- [ ] Mobile (375×667)

### Error Scenarios
- [ ] API offline
- [ ] Slow network (3G throttling)
- [ ] Invalid JSON in config editor
- [ ] Session timeout

---

## Estimated Effort

| Category | Hours |
|----------|-------|
| High priority fixes | 8h |
| Medium priority enhancements | 6h |
| Low priority features | 9h |
| **Total** | **23h** |

**Recommended approach:**
- Sprint 1 (8h): High priority (accessibility + stability)
- Sprint 2 (6h): Medium priority (UX polish)
- Sprint 3 (optional): Low priority features

---

## Code Quality Notes

**Strengths:**
- Consistent Vue 3 Composition API usage
- TypeScript throughout
- Clean component structure
- Good separation of concerns (API client separate)

**Potential issues:**
- No unit tests found
- No E2E tests
- API client could use better error typing
- Some magic numbers (30s refresh interval hardcoded)

**Recommendations:**
- Add Vitest for unit tests
- Add Playwright for E2E
- Extract constants to config
- Add JSDoc comments for complex logic

---

## Conclusion

The Nachos Admin UI is **production-ready with minor improvements needed**. The design is clean, modern, and functional. Focus efforts on:

1. **Accessibility** - Critical for compliance and usability
2. **Mobile responsiveness** - Expand supported devices
3. **Error resilience** - Better handling and recovery

**No major redesign required.** 🎉
