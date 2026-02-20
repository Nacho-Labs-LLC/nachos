import { createRouter, createWebHistory } from 'vue-router';
import StatusPage from '../pages/StatusPage.vue';
import ConfigPage from '../pages/ConfigPage.vue';
import AuditPage from '../pages/AuditPage.vue';
import SessionsPage from '../pages/SessionsPage.vue';
import SkillsPage from '../pages/SkillsPage.vue';
import ServicesPage from '../pages/ServicesPage.vue';
import LogsPage from '../pages/LogsPage.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/status' },
    { path: '/status', component: StatusPage },
    { path: '/config', component: ConfigPage },
    { path: '/audit', component: AuditPage },
    { path: '/sessions', component: SessionsPage },
    { path: '/skills', component: SkillsPage },
    { path: '/services', component: ServicesPage },
    { path: '/logs', component: LogsPage },
  ],
});
