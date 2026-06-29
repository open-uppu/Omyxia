/**
 * Sensitive field redaction for audit logs.
 *
 * These keys (case-insensitive) are replaced with the literal string '[REDACTED]'
 * in any audit-logged payload before being persisted.
 */
export const SENSITIVE_KEYS = new Set([
  'password',
  'passwordhash',
  'password_hash',
  'token',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'jwt',
  'secret',
  'apitoken',
  'api_token',
  'authorization',
  'cookie',
  'set-cookie',
  'totpsecret',
  'totp_secret',
  'mfa_secret',
  'privatekey',
  'private_key',
]);

const REDACTED = '[REDACTED]';

export function redact<T>(value: T): T {
  return redactDeep(value as unknown, new WeakSet()) as T;
}

function redactDeep(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (seen.has(value as object)) return '[Circular]';
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((v) => redactDeep(v, seen));
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) {
      out[k] = REDACTED;
    } else if (v && typeof v === 'object') {
      out[k] = redactDeep(v, seen);
    } else {
      out[k] = v;
    }
  }
  return out;
}