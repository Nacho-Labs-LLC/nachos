export interface GatewayHealth {
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unreachable';
  version?: string;
  uptime?: number;
  checks?: Record<string, string>;
}

export interface ChannelStatus {
  enabled: boolean;
}

export interface ToolStatus {
  enabled: boolean;
}

export interface ConfigStatus {
  llm: { provider?: string; model?: string };
  channels: Record<string, ChannelStatus>;
  tools: Record<string, ToolStatus>;
  security: { mode?: string };
}

export interface StatusResponse {
  gateway: GatewayHealth;
  config: ConfigStatus | null;
  timestamp: string;
}

export interface ConfigResponse {
  content: string;
  parsed: Record<string, unknown>;
}

export interface AuditRow {
  id: string;
  timestamp: string;
  instance_id: string;
  user_id: string;
  session_id: string;
  channel: string;
  event_type: string;
  action: string;
  resource: string | null;
  outcome: string;
  reason: string | null;
  security_mode: string;
  policy_matched: string | null;
  details: string | null;
  created_at: string;
}

export interface AuditResponse {
  events: AuditRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SessionRow {
  id: string;
  channel: string;
  user_id: string;
  conversation_id: string;
  status: 'active' | 'paused' | 'ended';
  system_prompt: string | null;
  created_at: string;
  updated_at: string;
  message_count: number;
}

export interface SessionsResponse {
  sessions: SessionRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SkillEntry {
  name: string;
  description: string;
  status: 'active' | 'denied' | 'disabled';
  reason?: string;
  homepage?: string;
}

export interface SkillsResponse {
  skills: SkillEntry[];
}

export interface ServiceStatus {
  name: string; // e.g. "gateway"
  container: string; // e.g. "nachos-gateway"
  state: string; // "running" | "exited" | "paused" etc.
  health: string; // "healthy" | "unhealthy" | "starting" | "none"
  uptime: string; // human-readable uptime string (from Docker Status field)
  image: string;
}

export interface ServicesResponse {
  services: ServiceStatus[];
}
