import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// next/navigation useRouter is a hook used inside ProjectsList.
const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: vi.fn(), back: vi.fn() }),
}));

import { ProjectsList } from './ProjectsList';

interface Project {
  id: string;
  tenantId: string;
  name: string;
  description?: string | null;
  status: string;
  ownerId?: string | null;
  createdAt: string;
  updatedAt: string;
  tasks?: unknown[];
}

const fixture: Project[] = [
  {
    id: 'p-1',
    tenantId: 't-1',
    name: 'Apollo',
    description: 'Rocket delivery',
    status: 'ACTIVE',
    ownerId: 'u-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: [{ id: 'task-1' }, { id: 'task-2' }],
  },
  {
    id: 'p-2',
    tenantId: 't-1',
    name: 'Hermes',
    description: null,
    status: 'PLANNING',
    ownerId: null,
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  },
];

function makeFetchMock(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = vi.fn(impl) as any;
}

describe('ProjectsList', () => {
  beforeEach(() => {
    mockPush.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the list from initialData without calling fetch', () => {
    render(<ProjectsList initialData={fixture} />);
    const rows = screen.getAllByTestId('project-card');
    expect(rows).toHaveLength(2);
    expect(screen.getByText('Apollo')).toBeTruthy();
    expect(screen.getByText('Hermes')).toBeTruthy();
  });

  it('shows task count when project has tasks', () => {
    render(<ProjectsList initialData={fixture} />);
    expect(screen.getByText(/2 tasks/)).toBeTruthy();
  });

  it('singular task copy when exactly one task', () => {
    render(
      <ProjectsList
        initialData={[{ ...fixture[0], id: 'p-solo', tasks: [{ id: 't1' }] }]}
      />,
    );
    expect(screen.getByText(/1 task\b/)).toBeTruthy();
  });

  it('shows the empty state when no projects', () => {
    render(<ProjectsList initialData={[]} />);
    expect(screen.getByTestId('projects-empty')).toBeTruthy();
  });

  it('renders loading state when no initial data', () => {
    makeFetchMock(() => new Promise(() => {})); // never resolves
    render(<ProjectsList />);
    expect(screen.getByTestId('projects-loading')).toBeTruthy();
  });

  it('fetches /api/projects when mounted without initial data', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(fixture), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    makeFetchMock(fetchSpy);
    render(<ProjectsList />);
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/projects',
        expect.objectContaining({ credentials: 'same-origin' }),
      );
    });
    await waitFor(() => {
      expect(screen.getAllByTestId('project-card')).toHaveLength(2);
    });
  });

  it('shows error state when fetch fails', async () => {
    makeFetchMock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ message: 'Forbidden' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    render(<ProjectsList />);
    await waitFor(() => {
      expect(screen.getByTestId('projects-error')).toBeTruthy();
    });
    expect(screen.getByTestId('projects-error').textContent).toMatch(/forbidden/i);
  });

  it('submits the create form, posts to /api/projects, and routes to detail', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'p-new',
          tenantId: 't-1',
          name: 'New',
          status: 'PLANNING',
          createdAt: '2026-01-03T00:00:00.000Z',
          updatedAt: '2026-01-03T00:00:00.000Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    makeFetchMock(fetchSpy);
    render(<ProjectsList initialData={fixture} />);

    fireEvent.change(screen.getByTestId('projects-create-name'), {
      target: { value: 'New' },
    });
    fireEvent.change(screen.getByTestId('projects-create-description'), {
      target: { value: 'Cool stuff' },
    });
    fireEvent.click(screen.getByTestId('projects-create-submit'));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/projects',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    const [, init] = fetchSpy.mock.calls[0]!;
    expect(JSON.parse(init!.body as string)).toMatchObject({
      name: 'New',
      description: 'Cool stuff',
    });
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/projects/p-new');
    });
  });

  it('does not submit when name is empty (button disabled)', () => {
    render(<ProjectsList initialData={fixture} />);
    const btn = screen.getByTestId('projects-create-submit') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('shows error on create failure', async () => {
    const fetchSpy = vi
      .fn()
      // First call: list (success — returns fixture).
      .mockResolvedValueOnce(
        new Response(JSON.stringify(fixture), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      // Second call: create (fails).
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Boom' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    makeFetchMock(fetchSpy);
    render(<ProjectsList />);
    await waitFor(() => {
      expect(screen.getAllByTestId('project-card')).toHaveLength(2);
    });

    fireEvent.change(screen.getByTestId('projects-create-name'), {
      target: { value: 'New' },
    });
    fireEvent.click(screen.getByTestId('projects-create-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('projects-error').textContent).toMatch(/boom/i);
    });
  });

  it('project card link points to the detail page with encoded id', () => {
    render(<ProjectsList initialData={fixture} />);
    const links = screen.getAllByTestId('project-card-link') as HTMLAnchorElement[];
    expect(links[0]!.getAttribute('href')).toBe('/projects/p-1');
    // Verify URL-encoding for ids with special characters.
    render(
      <ProjectsList
        initialData={[
          {
            ...fixture[0],
            id: 'p with space',
            name: 'Encoded',
          },
        ]}
      />,
    );
    const all = screen.getAllByTestId('project-card-link') as HTMLAnchorElement[];
    expect(all.some((a) => a.getAttribute('href') === '/projects/p%20with%20space')).toBe(true);
  });
});