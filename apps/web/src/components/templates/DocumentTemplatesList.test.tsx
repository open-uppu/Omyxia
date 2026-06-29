import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: vi.fn(), back: vi.fn() }),
}));

import { DocumentTemplatesList } from './DocumentTemplatesList';

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

const fixture: Tpl[] = [
  {
    id: 'tpl-1',
    tenantId: 't-1',
    name: 'NDA',
    category: 'Legal',
    bodyHtml: '<p>Hello {{party}}</p>',
    variables: ['party'],
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'tpl-2',
    tenantId: 't-1',
    name: 'Offer Letter',
    category: null,
    bodyHtml: '<p>Welcome {{name}}</p>',
    variables: [],
    isActive: true,
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  },
];

describe('DocumentTemplatesList', () => {
  beforeEach(() => {
    mockPush.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders initialData without calling fetch', () => {
    render(<DocumentTemplatesList initialData={fixture} />);
    expect(screen.getAllByTestId('template-card')).toHaveLength(2);
    expect(screen.getByText('NDA')).toBeTruthy();
    expect(screen.getByText('Offer Letter')).toBeTruthy();
  });

  it('shows empty state', () => {
    render(<DocumentTemplatesList initialData={[]} />);
    expect(screen.getByTestId('templates-empty')).toBeTruthy();
  });

  it('shows loading state when no initialData', () => {
    globalThis.fetch = vi.fn(() => new Promise(() => {})) as any;
    render(<DocumentTemplatesList />);
    expect(screen.getByTestId('templates-loading')).toBeTruthy();
  });

  it('fetches /api/docs/templates on mount', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(fixture), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    globalThis.fetch = fetchSpy as any;
    render(<DocumentTemplatesList />);
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/docs/templates',
        expect.objectContaining({ credentials: 'same-origin' }),
      );
    });
    await waitFor(() => {
      expect(screen.getAllByTestId('template-card')).toHaveLength(2);
    });
  });

  it('shows error banner on fetch failure', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as any;
    render(<DocumentTemplatesList />);
    await waitFor(() => {
      expect(screen.getByTestId('templates-error').textContent).toMatch(/forbidden/i);
    });
  });

  it('renders declared variables hint on each card', () => {
    render(<DocumentTemplatesList initialData={fixture} />);
    expect(screen.getByText(/Vars: party/)).toBeTruthy();
  });

  it('create button disabled when name or body empty', () => {
    render(<DocumentTemplatesList initialData={fixture} />);
    const btn = screen.getByTestId('templates-create-submit') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.change(screen.getByTestId('templates-create-name'), {
      target: { value: 'Test' },
    });
    expect(btn.disabled).toBe(true); // body still empty
    fireEvent.change(screen.getByTestId('templates-create-body'), {
      target: { value: '<p>x</p>' },
    });
    expect(btn.disabled).toBe(false);
  });

  it('submits create form, posts to /api/docs/templates, and routes to detail', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'tpl-new',
          tenantId: 't-1',
          name: 'Test',
          category: null,
          bodyHtml: '<p>x</p>',
          variables: [],
          isActive: true,
          createdAt: '2026-01-03T00:00:00.000Z',
          updatedAt: '2026-01-03T00:00:00.000Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    globalThis.fetch = fetchSpy as any;
    render(<DocumentTemplatesList initialData={fixture} />);

    fireEvent.change(screen.getByTestId('templates-create-name'), {
      target: { value: 'Test' },
    });
    fireEvent.change(screen.getByTestId('templates-create-category'), {
      target: { value: 'Sales' },
    });
    fireEvent.change(screen.getByTestId('templates-create-body'), {
      target: { value: '<p>x</p>' },
    });
    fireEvent.click(screen.getByTestId('templates-create-submit'));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/docs/templates',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    const [, init] = fetchSpy.mock.calls[0]!;
    const body = JSON.parse(init!.body as string);
    expect(body.name).toBe('Test');
    expect(body.category).toBe('Sales');
    expect(body.bodyHtml).toBe('<p>x</p>');
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/docs/templates/tpl-new');
    });
  });

  it('template card link points to detail page', () => {
    render(<DocumentTemplatesList initialData={fixture} />);
    const links = screen.getAllByTestId('template-card-link') as HTMLAnchorElement[];
    expect(links[0]!.getAttribute('href')).toBe('/docs/templates/tpl-1');
  });

  it('shows error on create failure', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(fixture), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Bad request' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    globalThis.fetch = fetchSpy as any;
    render(<DocumentTemplatesList />);
    await waitFor(() => {
      expect(screen.getAllByTestId('template-card')).toHaveLength(2);
    });
    fireEvent.change(screen.getByTestId('templates-create-name'), {
      target: { value: 'Test' },
    });
    fireEvent.change(screen.getByTestId('templates-create-body'), {
      target: { value: '<p>x</p>' },
    });
    fireEvent.click(screen.getByTestId('templates-create-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('templates-error').textContent).toMatch(/bad request/i);
    });
  });
});