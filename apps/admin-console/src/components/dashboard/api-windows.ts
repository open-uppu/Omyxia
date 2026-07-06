/**
 * Centralised list of API call windows used by the dashboard. Lives
 * in its own file so future cards (e.g. "Tenant Activity") can reuse
 * the same labels without re-declaring.
 */
export const API_WINDOW_OPTIONS = ['24h', '7d', '30d'] as const;
export type ApiWindowOption = (typeof API_WINDOW_OPTIONS)[number];
