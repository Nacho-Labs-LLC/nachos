import type {
  GatewayHealth,
  StatusResponse,
  ConfigResponse,
  AuditRow,
  AuditResponse,
  SessionRow,
  SessionsResponse,
  SkillEntry,
  SkillsResponse,
  ServiceStatus,
  ServicesResponse,
} from '../../../src/types.ts';

export type {
  GatewayHealth,
  StatusResponse,
  ConfigResponse,
  AuditRow,
  AuditResponse,
  SessionRow,
  SessionsResponse,
  SkillEntry,
  SkillsResponse,
  ServiceStatus,
  ServicesResponse,
};

const BASE = import.meta.env.VITE_API_BASE ?? '';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text);
  }
  return res.json() as Promise<T>;
}

// ── Status ────────────────────────────────────────────────────────────────────

export const getStatus = () => request<StatusResponse>('/api/status');

// ── Config ────────────────────────────────────────────────────────────────────

export const getConfig = () => request<ConfigResponse>('/api/config');

export const putConfig = (content: string) =>
  request<{ ok: boolean }>('/api/config', {
    method: 'PUT',
    body: JSON.stringify({ content }),
  });

export const patchConfig = (path: string, value: unknown) =>
  request<{ ok: boolean; parsed: unknown }>('/api/config', {
    method: 'PATCH',
    body: JSON.stringify({ path, value }),
  });

// ── Audit ─────────────────────────────────────────────────────────────────────

export interface AuditFilters {
  page?: number;
  pageSize?: number;
  event_type?: string;
  channel?: string;
  outcome?: string;
}

export const getAudit = (filters: AuditFilters = {}) => {
  const params = new URLSearchParams();
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
  if (filters.event_type) params.set('event_type', filters.event_type);
  if (filters.channel) params.set('channel', filters.channel);
  if (filters.outcome) params.set('outcome', filters.outcome);
  const qs = params.toString();
  return request<AuditResponse>(`/api/audit${qs ? `?${qs}` : ''}`);
};

export const getAuditEventTypes = () => request<string[]>('/api/audit/event-types');

// ── Sessions ─────────────────────────────────────────────────────────────────

export interface SessionFilters {
  page?: number;
  pageSize?: number;
  status?: string;
  channel?: string;
}

export const getSessions = (filters: SessionFilters = {}) => {
  const params = new URLSearchParams();
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
  if (filters.status) params.set('status', filters.status);
  if (filters.channel) params.set('channel', filters.channel);
  const qs = params.toString();
  return request<SessionsResponse>(`/api/sessions${qs ? `?${qs}` : ''}`);
};

export const expireSession = (id: string) =>
  request<{ ok: boolean }>(`/api/sessions/${id}/expire`, { method: 'POST' });

// ── Skills ───────────────────────────────────────────────────────────────────

export const getSkills = () => request<SkillsResponse>('/api/skills');

// ── Services ─────────────────────────────────────────────────────────────────

export const getServices = () => request<ServicesResponse>('/api/services');
export const restartService = (name: string) =>
  request<{ ok: boolean }>(`/api/services/${name}/restart`, { method: 'POST' });
export const stopService = (name: string) =>
  request<{ ok: boolean }>(`/api/services/${name}/stop`, { method: 'POST' });
export const startService = (name: string) =>
  request<{ ok: boolean }>(`/api/services/${name}/start`, { method: 'POST' });
