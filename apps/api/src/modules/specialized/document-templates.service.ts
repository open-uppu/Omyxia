import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantScopedService } from './base.service';

const ALLOWED_TEMPLATE_FIELDS = ['name', 'category', 'bodyHtml', 'variables', 'isActive'] as const;

// -----------------------------------------------------------------------------
// Template render security helpers (exported for unit tests)
// -----------------------------------------------------------------------------

/** Names of variables that the renderer will substitute. */
const VAR_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/;

/** Match `{{var}}` or `{{{var}}}` — used in the body. */
const PLACEHOLDER_RE = /\{\{\{([a-zA-Z_][a-zA-Z0-9_]{0,63})\}\}\}|\{\{([a-zA-Z_][a-zA-Z0-9_]{0,63})\}\}/g;

/** Maximum length of a substituted value (per variable). */
const MAX_VALUE_LENGTH = 16 * 1024;

/**
 * HTML-entity-encode a string. Use this for every value that ends up in the
 * output when the template uses the double-brace `{{var}}` form.
 */
export function escapeHtml(input: unknown): string {
  return String(input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Drop dangerous tags and event handlers from a string intended to be inserted
 * as raw HTML. We intentionally do NOT try to parse HTML — a regex pass that
 * removes the obvious injection vectors is sufficient here because:
 *
 *  - Input values come from authenticated, tenant-scoped users.
 *  - Template authors are the same trust boundary as template consumers.
 *  - The renderer is not a generic HTML sanitizer; it strips the well-known
 *    XSS vectors (script / iframe / object / embed / form / style with
 *    expression, and any `on*=...` handler attribute).
 *
 * Anything that survives is plain HTML which is the caller's responsibility
 * to validate before exposing to anonymous viewers.
 */
export function sanitizeRawHtml(input: unknown): string {
  let s = String(input ?? '');
  // Strip <script>...</script>, <iframe>, <object>, <embed>, <form>, <style>.
  s = s.replace(
    /<(script|iframe|object|embed|form|style)\b[^>]*>[\s\S]*?<\/\1>/gi,
    '',
  );
  // Strip self-closing variants of the above (e.g. <script src=x />).
  s = s.replace(
    /<(script|iframe|object|embed|form|style)\b[^>]*\/?>/gi,
    '',
  );
  // Strip on*=...="..." attributes (handles quoted + unquoted).
  s = s.replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  // Strip javascript: / vbscript: / data:text/html URLs in href/src.
  s = s.replace(
    /\b(href|src|action|formaction)\s*=\s*(?:"\s*(?:javascript|vbscript|data:text\/html)\s*:[^"]*"|'\s*(?:javascript|vbscript|data:text\/html)\s*:[^']*')/gi,
    '',
  );
  return s;
}

/**
 * Truncate a string to MAX_VALUE_LENGTH. Inputs longer than that are clamped
 * to avoid pathological template payloads (DoS guard).
 */
function clampLength(s: string): string {
  return s.length > MAX_VALUE_LENGTH ? s.slice(0, MAX_VALUE_LENGTH) : s;
}

/**
 * Replace `{{var}}` and `{{{var}}}` placeholders in a template body.
 *
 * - Triple-brace `{{{var}}}` inserts the sanitized-raw value (HTML preserved,
 *   scripts / event handlers stripped). Unknown vars become empty string.
 * - Double-brace `{{var}}` inserts the HTML-escaped value (safe for any
 *   surrounding context). Unknown vars become empty string.
 * - Names that don't match `VAR_NAME_RE` are left as literal text (no
 *   substitution) — this prevents `{ {{` or weirdly-formed placeholders from
 *   being treated as variables.
 *
 * The function never throws on malformed input; it returns the (possibly
 * empty) substituted body.
 */
export function renderTemplate(
  bodyHtml: unknown,
  variables: Record<string, unknown> | null | undefined,
): string {
  if (typeof bodyHtml !== 'string') return '';
  const vars = variables && typeof variables === 'object' ? variables : {};
  return bodyHtml.replace(PLACEHOLDER_RE, (_match, rawName: string | undefined, safeName: string | undefined) => {
    const name = rawName ?? safeName;
    if (!name || !VAR_NAME_RE.test(name)) return _match; // leave literal
    if (!Object.prototype.hasOwnProperty.call(vars, name)) return '';
    const raw = clampLength(String(vars[name] ?? ''));
    return rawName !== undefined ? sanitizeRawHtml(raw) : escapeHtml(raw);
  });
}

// -----------------------------------------------------------------------------
// DocumentTemplatesService
// -----------------------------------------------------------------------------

/**
 * DocumentTemplatesService — minimal viable Document Templates (Phase E / v0.3.1).
 *
 * Responsibilities:
 *  - Tenant-scoped CRUD for `DocumentTemplate` rows.
 *  - Render a template body with caller-supplied variables, returning the
 *    substituted HTML + a default title for downstream instantiation.
 *
 * The render security model is documented on `renderTemplate` above.
 *
 * Routes (see document-templates.controller.ts):
 *  GET    /docs/templates
 *  GET    /docs/templates/:id
 *  POST   /docs/templates
 *  PATCH  /docs/templates/:id
 *  DELETE /docs/templates/:id
 *  POST   /docs/templates/:id/render
 */
@Injectable()
export class DocumentTemplatesService extends TenantScopedService {
  private async findTemplateForTenant(id: string) {
    const tpl = await this.prisma.documentTemplate.findFirst({
      where: { id, tenantId: this.getTenantId() },
    });
    if (!tpl) throw new NotFoundException('Template not found');
    return tpl;
  }

  private pickTemplateFields(body: Record<string, unknown> | undefined | null) {
    if (!body || typeof body !== 'object') return {};
    const out: Record<string, unknown> = {};
    for (const k of ALLOWED_TEMPLATE_FIELDS) {
      if (body[k] !== undefined) out[k] = body[k];
    }
    return out;
  }

  async listTemplates() {
    return this.prisma.documentTemplate.findMany({
      where: { tenantId: this.getTenantId() },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getTemplate(id: string) {
    return this.findTemplateForTenant(id);
  }

  async createTemplate(body: Record<string, unknown>) {
    const data = this.pickTemplateFields(body);
    if (!data.name || typeof data.name !== 'string') {
      throw new ForbiddenException('name is required');
    }
    if (typeof data.bodyHtml !== 'string') {
      throw new ForbiddenException('bodyHtml is required');
    }
    if (data.variables !== undefined && !Array.isArray(data.variables)) {
      throw new ForbiddenException('variables must be an array of strings');
    }
    return this.prisma.documentTemplate.create({
      data: {
        ...data,
        tenantId: this.getTenantId(),
      },
    });
  }

  async updateTemplate(id: string, body: Record<string, unknown>) {
    await this.findTemplateForTenant(id);
    const data = this.pickTemplateFields(body);
    if (Object.keys(data).length === 0) {
      throw new ForbiddenException('No updatable fields supplied');
    }
    if (data.variables !== undefined && !Array.isArray(data.variables)) {
      throw new ForbiddenException('variables must be an array of strings');
    }
    return this.prisma.documentTemplate.update({
      where: { id },
      data,
    });
  }

  async deleteTemplate(id: string) {
    await this.findTemplateForTenant(id);
    await this.prisma.documentTemplate.delete({ where: { id } });
    return { id, deleted: true };
  }

  /**
   * Render a template with caller-supplied variables.
   *
   * Returns:
   *  - `renderedHtml` — the bodyHtml with placeholders substituted.
   *  - `title` — defaults to the template name (callers can override downstream
   *    when instantiating a DocumentInstance).
   *
   * The function does not persist a DocumentInstance; the render endpoint is
   * intentionally idempotent and side-effect free so it can be previewed.
   */
  async render(id: string, variables: Record<string, unknown> | null | undefined) {
    const tpl = await this.findTemplateForTenant(id);
    return {
      templateId: tpl.id,
      title: tpl.name,
      renderedHtml: renderTemplate(tpl.bodyHtml, variables ?? {}),
    };
  }
}