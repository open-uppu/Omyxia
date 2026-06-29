/**
 * Lightweight API client for omyxia frontend.
 *
 * Wraps `fetch` with:
 * - JSON content-negotiation
 * - Cookie-based session (we never read JWTs in JS — they stay in HttpOnly cookies)
 * - Token round-trip via Set-Cookie is the backend's responsibility (auth
 *   endpoints set HttpOnly cookies via the proxy)
 * - Typed responses for the endpoints used by auth/tenant/MFA screens
 */

import type { Tenant } from '@omyxia/shared-types';

/** Tenant as returned by `/auth/signup` and `/auth/switch-tenant` */
export interface TenantSummary {
  id: string;
  slug: string;
  name: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
}

export interface AuthSession {
  user: {
    id: string;
    email: string;
    name: string;
  };
  tenant: TenantSummary;
  accessToken: string;
  expiresAt: string;
}

export interface MfaEnrollment {
  secret: string;
  otpauthUrl: string;
  qrCodeUrl: string;
  recoveryCodes: string[];
}

export interface MfaVerification {
  success: boolean;
  method?: 'TOTP' | 'RECOVERY_CODE';
}

export interface UserTenantsResponse {
  tenants: TenantSummary[];
  currentTenantId: string;
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {}
): Promise<T> {
  const { json, headers, ...rest } = init;
  const finalHeaders: Record<string, string> = {
    Accept: 'application/json',
    ...(headers as Record<string, string> | undefined),
  };
  let body: BodyInit | undefined;
  if (json !== undefined) {
    finalHeaders['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (rest.body) {
    body = rest.body as BodyInit;
  }

  const res = await fetch(`/api${path}`, {
    ...rest,
    headers: finalHeaders,
    body,
    credentials: 'same-origin',
  });

  const text = await res.text();
  const data = text ? safeJson(text) : undefined;
  if (!res.ok) {
    const msg =
      (data && typeof data === 'object' && 'message' in data
        ? String((data as { message: unknown }).message)
        : `Request failed: ${res.status}`) || `Request failed: ${res.status}`;
    throw new ApiError(res.status, msg, data);
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Auth endpoints — these set the HttpOnly session cookie via the server.
 * The returned `accessToken` may also be set in a non-HttpOnly cookie by
 * the backend for SSR; the frontend should rely on the cookie for auth.
 */
export const api = {
  auth: {
    signup: (input: {
      email: string;
      password: string;
      name: string;
      tenantName: string;
      locale?: string;
    }) => request<AuthSession>('/auth/signup', { method: 'POST', json: input }),
    login: (input: { email: string; password: string }) =>
      request<AuthSession>('/auth/login', { method: 'POST', json: input }),
    logout: () =>
      request<{ success: true }>('/auth/logout', { method: 'POST' }),
  },
  tenants: {
    /** List tenants the current user is a member of */
    listMine: () => request<UserTenantsResponse>('/tenants/me', { method: 'GET' }),
    /**
     * Switch active tenant. Backend sets a new session cookie scoped to the
     * chosen tenant and returns a fresh access token.
     */
    switch: (tenantId: string) =>
      request<AuthSession>(`/tenants/${encodeURIComponent(tenantId)}/switch`, {
        method: 'POST',
      }),
    create: (input: { name: string }) =>
      request<TenantSummary>('/tenants', { method: 'POST', json: input }),
    getCurrent: () => request<Tenant>('/tenants/current', { method: 'GET' }),
  },
  mfa: {
    enroll: () =>
      request<MfaEnrollment>('/mfa/enroll', { method: 'POST' }),
    verify: (code: string) =>
      request<MfaVerification>('/mfa/verify', { method: 'POST', json: { code } }),
    status: () =>
      request<{ enabled: boolean; remainingRecoveryCodes: number }>(
        '/mfa/status',
        { method: 'GET' }
      ),
    disable: (password: string) =>
      request<{ success: true }>('/mfa/disable', {
        method: 'POST',
        json: { password },
      }),
  },
  invites: {
    send: (input: { emails: string[]; role?: string }) =>
      request<{ sent: number }>('/invites', { method: 'POST', json: input }),
  },
  // Phase E — Project Management (v0.3.1)
  projects: {
    list: () => request<Project[]>('/projects', { method: 'GET' }),
    get: (id: string) => request<Project>(`/projects/${encodeURIComponent(id)}`, { method: 'GET' }),
    create: (input: { name: string; description?: string; status?: string; ownerId?: string }) =>
      request<Project>('/projects', { method: 'POST', json: input }),
    update: (id: string, input: Partial<{ name: string; description: string; status: string }>) =>
      request<Project>(`/projects/${encodeURIComponent(id)}`, { method: 'PATCH', json: input }),
    delete: (id: string) =>
      request<{ id: string; deleted: true }>(`/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    listTasks: (projectId: string) =>
      request<ProjectTask[]>(`/projects/${encodeURIComponent(projectId)}/tasks`, { method: 'GET' }),
    createTask: (projectId: string, input: { title: string; description?: string; priority?: string; status?: string }) =>
      request<ProjectTask>(`/projects/${encodeURIComponent(projectId)}/tasks`, { method: 'POST', json: input }),
    updateTask: (projectId: string, taskId: string, input: Partial<{ title: string; description: string; priority: string; status: string }>) =>
      request<ProjectTask>(
        `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`,
        { method: 'PATCH', json: input },
      ),
    updateTaskStatus: (projectId: string, taskId: string, status: string) =>
      request<ProjectTask>(
        `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/status`,
        { method: 'PATCH', json: { status } },
      ),
    deleteTask: (projectId: string, taskId: string) =>
      request<{ id: string; deleted: true }>(
        `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`,
        { method: 'DELETE' },
      ),
  },
  // Phase E — Document Templates (v0.3.1)
  templates: {
    list: () => request<DocumentTemplate[]>('/docs/templates', { method: 'GET' }),
    get: (id: string) => request<DocumentTemplate>(`/docs/templates/${encodeURIComponent(id)}`, { method: 'GET' }),
    create: (input: { name: string; category?: string; bodyHtml: string; variables?: string[] }) =>
      request<DocumentTemplate>('/docs/templates', { method: 'POST', json: input }),
    update: (id: string, input: Partial<{ name: string; category: string; bodyHtml: string; variables: string[]; isActive: boolean }>) =>
      request<DocumentTemplate>(`/docs/templates/${encodeURIComponent(id)}`, { method: 'PATCH', json: input }),
    delete: (id: string) =>
      request<{ id: string; deleted: true }>(`/docs/templates/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    render: (id: string, variables: Record<string, string | number>) =>
      request<RenderResult>(
        `/docs/templates/${encodeURIComponent(id)}/render`,
        { method: 'POST', json: { variables } },
      ),
  },
};

// Phase E — typed shapes for Project Management
export interface Project {
  id: string;
  tenantId: string;
  name: string;
  code?: string | null;
  description?: string | null;
  status: string;
  ownerId?: string | null;
  createdAt: string;
  updatedAt: string;
  tasks?: ProjectTask[];
}

export interface ProjectTask {
  id: string;
  tenantId: string;
  projectId: string;
  parentId?: string | null;
  assigneeId?: string | null;
  title: string;
  description?: string | null;
  status: string;
  priority: string;
  dueDate?: string | null;
  estimatedHours?: number | string | null;
  actualHours?: number | string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentTemplate {
  id: string;
  tenantId: string;
  name: string;
  category?: string | null;
  bodyHtml: string;
  variables: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RenderResult {
  templateId: string;
  title: string;
  renderedHtml: string;
}
