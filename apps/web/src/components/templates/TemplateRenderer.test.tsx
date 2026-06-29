import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));

import { TemplateRenderer } from './TemplateRenderer';

interface Tpl {
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

const baseTpl: Tpl = {
  id: 'tpl-1',
  tenantId: 't-1',
  name: 'NDA',
  category: 'Legal',
  bodyHtml: '<p>Hello {{party}}, this NDA is between {{{raw}}}.</p>',
  variables: ['party', 'raw'],
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('TemplateRenderer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders template metadata from initialData', () => {
    render(<TemplateRenderer templateId="tpl-1" initialData={baseTpl} />);
    expect(screen.getByTestId('template-name').textContent).toBe('NDA');
    expect(screen.getByText(/Category: Legal/)).toBeTruthy();
  });

  it('derives variable inputs from the body and merges with declared ones', () => {
    render(<TemplateRenderer templateId="tpl-1" initialData={baseTpl} />);
    expect(screen.getByTestId('template-var-party')).toBeTruthy();
    expect(screen.getByTestId('template-var-raw')).toBeTruthy();
  });

  it('shows no-vars state when template has no placeholders', () => {
    render(
      <TemplateRenderer
        templateId="tpl-1"
        initialData={{ ...baseTpl, bodyHtml: '<p>Static</p>', variables: [] }}
      />,
    );
    expect(screen.getByTestId('template-no-vars')).toBeTruthy();
  });

  it('shows preview empty state before rendering', () => {
    render(<TemplateRenderer templateId="tpl-1" initialData={baseTpl} />);
    expect(screen.getByTestId('template-preview-empty')).toBeTruthy();
  });

  it('renders the source HTML in the details block', () => {
    render(<TemplateRenderer templateId="tpl-1" initialData={baseTpl} />);
    expect(screen.getByTestId('template-source').textContent).toBe(baseTpl.bodyHtml);
  });

  it('submits values and posts to /api/docs/templates/:id/render', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          templateId: 'tpl-1',
          title: 'NDA',
          renderedHtml: '<p>Hello Acme</p>',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    globalThis.fetch = fetchSpy as any;
    render(<TemplateRenderer templateId="tpl-1" initialData={baseTpl} />);

    fireEvent.change(screen.getByTestId('template-var-party'), {
      target: { value: 'Acme' },
    });
    fireEvent.click(screen.getByTestId('template-render-submit'));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/docs/templates/tpl-1/render',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    const [, init] = fetchSpy.mock.calls[0]!;
    const body = JSON.parse(init!.body as string);
    expect(body.variables.party).toBe('Acme');
    await waitFor(() => {
      expect(screen.getByTestId('template-preview-frame')).toBeTruthy();
    });
  });

  it('handles render failure with error banner', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as any;
    render(<TemplateRenderer templateId="tpl-1" initialData={baseTpl} />);

    fireEvent.click(screen.getByTestId('template-render-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('template-error').textContent).toMatch(/forbidden/i);
    });
  });

  it('fetches template when no initialData is supplied', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(baseTpl), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    globalThis.fetch = fetchSpy as any;
    render(<TemplateRenderer templateId="tpl-1" />);
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/docs/templates/tpl-1',
        expect.objectContaining({ credentials: 'same-origin' }),
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId('template-name').textContent).toBe('NDA');
    });
  });

  it('shows not-found state when fetch returns 404', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as any;
    render(<TemplateRenderer templateId="tpl-missing" />);
    await waitFor(() => {
      expect(screen.getByTestId('template-not-found')).toBeTruthy();
    });
  });

  it('shows loading state when initial fetch is pending', () => {
    globalThis.fetch = vi.fn(() => new Promise(() => {})) as any;
    render(<TemplateRenderer templateId="tpl-1" />);
    expect(screen.getByTestId('template-loading')).toBeTruthy();
  });
});