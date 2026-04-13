import { createRouter, createWebHistory } from 'vue-router';
import LoginPage from '../pages/LoginPage.vue';
import StatusPage from '../pages/StatusPage.vue';
import ConfigPage from '../pages/ConfigPage.vue';
import AuditPage from '../pages/AuditPage.vue';
import SessionsPage from '../pages/SessionsPage.vue';
import SkillsPage from '../pages/SkillsPage.vue';
import ServicesPage from '../pages/ServicesPage.vue';
import LogsPage from '../pages/LogsPage.vue';
import ChatPage from '../pages/ChatPage.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: LoginPage, meta: { public: true } },
    { path: '/', redirect: '/status' },
    { path: '/status', component: StatusPage },
    { path: '/config', component: ConfigPage },
    { path: '/audit', component: AuditPage },
    { path: '/sessions', component: SessionsPage },
    { path: '/skills', component: SkillsPage },
    { path: '/services', component: ServicesPage },
    { path: '/logs', component: LogsPage },
    { path: '/chat', component: ChatPage },
  ],
});

// Auth guard: check if the session cookie is valid before entering protected routes
router.beforeEach(async (to) => {
  if (to.meta.public) return true;

  try {
    const res = await fetch('/api/auth/check');
    if (res.ok) return true;
  } catch {
    // network error — fall through to login
  }

  return { path: '/login' };
});
