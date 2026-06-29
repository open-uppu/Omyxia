import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  DocumentTemplatesService,
  escapeHtml,
  renderTemplate,
  sanitizeRawHtml,
} from './document-templates.service';

const TENANT = 'tenant-A';

function makePrisma() {
  return {
    documentTemplate: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  } as any;
}

function makeTenantContext() {
  return {
    getTenantId: vi.fn().mockReturnValue(TENANT),
    getUserId: vi.fn().mockReturnValue('user-1'),
  } as any;
}

// =============================================================================
// Pure helper tests — render security (highest-value coverage)
// =============================================================================

describe('escapeHtml', () => {
  it('encodes the five HTML-sensitive characters', () => {
    expect(escapeHtml(`<script>"hi" 'x' & /`)).toBe(
      '&lt;script&gt;&quot;hi&quot; &#39;x&#39; &amp; &#x2F;',
    );
  });

  it('coerces null/undefined to empty string', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(42)).toBe('42');
  });
});

describe('sanitizeRawHtml', () => {
  it('strips <script>...</script> blocks', () => {
    const out = sanitizeRawHtml('<p>safe</p><script>alert(1)</script><p>after</p>');
    expect(out).not.toMatch(/<script/i);
    expect(out).toContain('<p>safe</p>');
    expect(out).toContain('<p>after</p>');
  });

  it('strips self-closing script tags', () => {
    const out = sanitizeRawHtml('<script src="x.js" />');
    expect(out).not.toMatch(/<script/i);
  });

  it('strips <iframe>, <object>, <embed>, <form>, <style>', () => {
    const inp =
      '<iframe src="x"></iframe><object data="x"></object><embed src="x"><form></form><style>body{}</style>';
    const out = sanitizeRawHtml(inp);
    expect(out).not.toMatch(/<iframe|<object|<embed|<form|<style/i);
  });

  it('strips on*= event handlers', () => {
    const out = sanitizeRawHtml(
      '<img src="x" onerror="alert(1)" onclick=\'x\' onmouseover=alert(2)>',
    );
    expect(out).not.toMatch(/onerror|onclick|onmouseover/i);
    expect(out).toContain('<img');
  });

  it('strips javascript: URLs in href/src', () => {
    const out = sanitizeRawHtml(
      '<a href="javascript:alert(1)">x</a><iframe src=\'javascript:alert(2)\'></iframe>',
    );
    expect(out).not.toMatch(/javascript:/i);
  });
});

describe('renderTemplate', () => {
  it('substitutes double-brace variables with escaped HTML', () => {
    const out = renderTemplate('Hello {{name}}!', { name: '<world>' });
    expect(out).toBe('Hello &lt;world&gt;!');
  });

  it('substitutes triple-brace variables with sanitized raw HTML', () => {
    const out = renderTemplate(
      '{{{html}}}',
      { html: '<b>bold</b><script>alert(1)</script>' },
    );
    expect(out).toContain('<b>bold</b>');
    expect(out).not.toMatch(/<script/i);
  });

  it('renders unknown variables as empty string', () => {
    expect(renderTemplate('Hi {{name}}, your id is {{orderId}}', { name: 'A' })).toBe(
      'Hi A, your id is ',
    );
  });

  it('leaves malformed placeholders as literal text (no injection)', () => {
    const out = renderTemplate(
      'Hello {{name}} and {{ 9bad }} and {{not a var}}',
      { name: 'A' },
    );
    // Valid one still substitutes.
    expect(out).toContain('Hello A');
    // Malformed ones are left literal.
    expect(out).toContain('{{ 9bad }}');
    expect(out).toContain('{{not a var}}');
  });

  it('clamps very long values to prevent DoS', () => {
    const big = 'x'.repeat(20_000);
    const out = renderTemplate('{{v}}', { v: big });
    expect(out.length).toBeLessThanOrEqual(16 * 1024);
  });

  it('treats non-string body as empty', () => {
    expect(renderTemplate(undefined, {})).toBe('');
    expect(renderTemplate(null, {})).toBe('');
  });

  it('treats null/undefined variables map as empty', () => {
    expect(renderTemplate('Hi {{name}}', null as any)).toBe('Hi ');
    expect(renderTemplate('Hi {{name}}', undefined as any)).toBe('Hi ');
  });

  it('escapes special characters in variable values', () => {
    const out = renderTemplate('a={{x}}', { x: `"hi" & 'go'` });
    expect(out).toBe('a=&quot;hi&quot; &amp; &#39;go&#39;');
  });

  it('still escapes __proto__ values when supplied as an own property', () => {
    // JSON.parse with a "__proto__" key creates an own property, not a
    // prototype mutation — so substitution runs, but the result must still
    // be HTML-escaped (defense in depth: the value is never trusted).
    const polluted = JSON.parse('{"__proto__":"<script>x()</script>"}');
    const out = renderTemplate('Hi {{__proto__}}', polluted);
    expect(out).toBe('Hi &lt;script&gt;x()&lt;&#x2F;script&gt;');
  });

  it('treats __proto__ as not-supplied (hasOwnProperty check)', () => {
    // When the caller doesn't supply __proto__ as an own property, the
    // hasOwnProperty guard refuses to walk the prototype chain. The
    // placeholder becomes an empty string rather than reading from
    // Object.prototype (which would otherwise leak "[object Object]").
    const out = renderTemplate('Hi {{__proto__}}', {});
    expect(out).toBe('Hi ');
  });

  it('handles a complex end-to-end template', () => {
    const tpl =
      '<p>Hello {{customerName}}, your order {{orderId}} is {{status}}.</p>' +
      '{{{notesBlock}}}';
    const out = renderTemplate(tpl, {
      customerName: 'Alice',
      orderId: 'O-42',
      status: '<b>ready</b>', // escaped
      notesBlock: '<i>Please review</i><script>x()</script>',
    });
    expect(out).toContain('Hello Alice');
    expect(out).toContain('O-42');
    expect(out).toContain('&lt;b&gt;ready&lt;&#x2F;b&gt;');
    expect(out).toContain('<i>Please review</i>');
    expect(out).not.toMatch(/<script/i);
  });
});

// =============================================================================
// Service-level tests — tenant isolation + CRUD
// =============================================================================

describe('DocumentTemplatesService — CRUD', () => {
  let service: DocumentTemplatesService;
  let prisma: ReturnType<typeof makePrisma>;
  let tenantContext: ReturnType<typeof makeTenantContext>;

  beforeEach(() => {
    prisma = makePrisma();
    tenantContext = makeTenantContext();
    service = new DocumentTemplatesService(prisma, tenantContext);
  });

  it('listTemplates scopes by tenantId', async () => {
    prisma.documentTemplate.findMany.mockResolvedValue([{ id: 'tpl-1' }]);
    await service.listTemplates();
    expect(prisma.documentTemplate.findMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('getTemplate throws NotFound when missing or wrong tenant', async () => {
    prisma.documentTemplate.findFirst.mockResolvedValue(null);
    await expect(service.getTemplate('tpl-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('getTemplate returns the row when found', async () => {
    prisma.documentTemplate.findFirst.mockResolvedValue({ id: 'tpl-1', name: 'NDA' });
    const res = await service.getTemplate('tpl-1');
    expect(res).toEqual({ id: 'tpl-1', name: 'NDA' });
  });

  it('createTemplate rejects when name missing', async () => {
    await expect(
      service.createTemplate({ bodyHtml: '<p>x</p>' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('createTemplate rejects when bodyHtml missing', async () => {
    await expect(
      service.createTemplate({ name: 'NDA' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('createTemplate rejects non-array variables', async () => {
    await expect(
      service.createTemplate({
        name: 'NDA',
        bodyHtml: '<p>x</p>',
        variables: 'not-an-array' as any,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('createTemplate persists with tenantId', async () => {
    prisma.documentTemplate.create.mockResolvedValue({ id: 'tpl-1' });
    await service.createTemplate({
      name: 'NDA',
      bodyHtml: '<p>{{party}}</p>',
      variables: ['party'],
    });
    const arg = prisma.documentTemplate.create.mock.calls[0]![0];
    expect(arg.data.tenantId).toBe(TENANT);
    expect(arg.data.name).toBe('NDA');
    expect(arg.data.bodyHtml).toBe('<p>{{party}}</p>');
    expect(arg.data.variables).toEqual(['party']);
  });

  it('createTemplate ignores unknown keys (tenantId, id)', async () => {
    prisma.documentTemplate.create.mockResolvedValue({ id: 'tpl-1' });
    await service.createTemplate({
      name: 'NDA',
      bodyHtml: 'x',
      tenantId: 'OTHER',
      id: 'forged',
    });
    const data = prisma.documentTemplate.create.mock.calls[0]![0].data;
    expect(data.tenantId).toBe(TENANT);
    expect(data.id).toBeUndefined();
  });

  it('updateTemplate throws Forbidden when no whitelisted fields', async () => {
    prisma.documentTemplate.findFirst.mockResolvedValue({ id: 'tpl-1' });
    await expect(
      service.updateTemplate('tpl-1', { tenantId: 'OTHER' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('updateTemplate validates variables type', async () => {
    prisma.documentTemplate.findFirst.mockResolvedValue({ id: 'tpl-1' });
    await expect(
      service.updateTemplate('tpl-1', { variables: 'oops' as any }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('updateTemplate returns the updated row', async () => {
    prisma.documentTemplate.findFirst.mockResolvedValue({ id: 'tpl-1' });
    prisma.documentTemplate.update.mockResolvedValue({ id: 'tpl-1', name: 'NDA v2' });
    const res = await service.updateTemplate('tpl-1', { name: 'NDA v2' });
    expect(prisma.documentTemplate.update).toHaveBeenCalledWith({
      where: { id: 'tpl-1' },
      data: { name: 'NDA v2' },
    });
    expect(res).toEqual({ id: 'tpl-1', name: 'NDA v2' });
  });

  it('deleteTemplate removes after tenant check', async () => {
    prisma.documentTemplate.findFirst.mockResolvedValue({ id: 'tpl-1' });
    prisma.documentTemplate.delete.mockResolvedValue({ id: 'tpl-1' });
    const res = await service.deleteTemplate('tpl-1');
    expect(prisma.documentTemplate.delete).toHaveBeenCalledWith({ where: { id: 'tpl-1' } });
    expect(res).toEqual({ id: 'tpl-1', deleted: true });
  });

  it('deleteTemplate throws NotFound for cross-tenant access', async () => {
    prisma.documentTemplate.findFirst.mockResolvedValue(null);
    await expect(service.deleteTemplate('tpl-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('DocumentTemplatesService — render', () => {
  let service: DocumentTemplatesService;
  let prisma: ReturnType<typeof makePrisma>;
  let tenantContext: ReturnType<typeof makeTenantContext>;

  beforeEach(() => {
    prisma = makePrisma();
    tenantContext = makeTenantContext();
    service = new DocumentTemplatesService(prisma, tenantContext);
  });

  it('returns the rendered HTML with title defaulting to template name', async () => {
    prisma.documentTemplate.findFirst.mockResolvedValue({
      id: 'tpl-1',
      name: 'NDA',
      bodyHtml: 'Hello {{party}}',
    });
    const res = await service.render('tpl-1', { party: 'Acme' });
    expect(res).toEqual({
      templateId: 'tpl-1',
      title: 'NDA',
      renderedHtml: 'Hello Acme',
    });
  });

  it('renders XSS payload safely with double-brace (escapes)', async () => {
    prisma.documentTemplate.findFirst.mockResolvedValue({
      id: 'tpl-1',
      name: 'NDA',
      bodyHtml: '<p>{{name}}</p>',
    });
    const res = await service.render('tpl-1', {
      name: '<script>alert(1)</script>',
    });
    expect(res.renderedHtml).not.toMatch(/<script/i);
    expect(res.renderedHtml).toContain('&lt;script&gt;');
  });

  it('sanitizes XSS payload with triple-brace (drops <script>)', async () => {
    prisma.documentTemplate.findFirst.mockResolvedValue({
      id: 'tpl-1',
      name: 'NDA',
      bodyHtml: '{{{block}}}',
    });
    const res = await service.render('tpl-1', {
      block: '<b>bold</b><script>alert(1)</script>',
    });
    expect(res.renderedHtml).toContain('<b>bold</b>');
    expect(res.renderedHtml).not.toMatch(/<script/i);
  });

  it('strips on*= handlers from triple-brace raw HTML', async () => {
    prisma.documentTemplate.findFirst.mockResolvedValue({
      id: 'tpl-1',
      name: 'NDA',
      bodyHtml: '{{{block}}}',
    });
    const res = await service.render('tpl-1', {
      block: '<img src=x onerror=alert(1)>',
    });
    expect(res.renderedHtml).not.toMatch(/onerror/i);
  });

  it('throws NotFound when template not in tenant', async () => {
    prisma.documentTemplate.findFirst.mockResolvedValue(null);
    await expect(service.render('tpl-1', {})).rejects.toBeInstanceOf(NotFoundException);
  });

  it('handles missing variables map gracefully', async () => {
    prisma.documentTemplate.findFirst.mockResolvedValue({
      id: 'tpl-1',
      name: 'NDA',
      bodyHtml: 'Hi {{name}}',
    });
    const res = await service.render('tpl-1', undefined);
    expect(res.renderedHtml).toBe('Hi ');
  });

  it('handles unknown variable by rendering empty string', async () => {
    prisma.documentTemplate.findFirst.mockResolvedValue({
      id: 'tpl-1',
      name: 'NDA',
      bodyHtml: '{{a}}|{{b}}',
    });
    const res = await service.render('tpl-1', { a: 'X' });
    expect(res.renderedHtml).toBe('X|');
  });
});