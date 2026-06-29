import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));

import { ProjectDetail } from './ProjectDetail';

interface Project {
  id: string;
  tenantId: string;
  name: string;
  description?: string | null;
  status: string;
  ownerId?: string | null;
  createdAt: string;
  updatedAt: string;
  tasks?: Array<{
    id: string;
    projectId: string;
    title: string;
    description?: string | null;
    status: string;
    priority: string;
    createdAt: string;
    updatedAt: string;
  }>;
}

const projectFixture: Project = {
  id: 'p-1',
  tenantId: 't-1',
  name: 'Apollo',
  description: 'Rocket delivery',
  status: 'ACTIVE',
  ownerId: 'u-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  tasks: [
    {
      id: 'task-1',
      projectId: 'p-1',
      title: 'Write tests',
      description: null,
      status: 'TODO',
      priority: 'HIGH',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'task-2',
      projectId: 'p-1',
      title: 'Ship MVP',
      description: null,
      status: 'IN_PROGRESS',
      priority: 'MEDIUM',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
};

describe('ProjectDetail', () => {
  beforeEach(() => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders project metadata from initialData', () => {
    render(<ProjectDetail projectId="p-1" initialData={projectFixture} />);
    expect(screen.getByTestId('project-name').textContent).toBe('Apollo');
    expect(screen.getByTestId('project-description').textContent).toBe(
      'Rocket delivery',
    );
  });

  it('renders two task rows', () => {
    render(<ProjectDetail projectId="p-1" initialData={projectFixture} />);
    expect(screen.getAllByTestId('project-task-row')).toHaveLength(2);
    expect(screen.getByText('Write tests')).toBeTruthy();
    expect(screen.getByText('Ship MVP')).toBeTruthy();
  });

  it('shows empty task state when project has no tasks', () => {
    render(
      <ProjectDetail
        projectId="p-1"
        initialData={{ ...projectFixture, tasks: [] }}
      />,
    );
    expect(screen.getByTestId('project-tasks-empty')).toBeTruthy();
  });

  it('shows loading state when no initialData and fetch is pending', () => {
    globalThis.fetch = vi.fn(() => new Promise(() => {})) as any;
    render(<ProjectDetail projectId="p-1" />);
    expect(screen.getByTestId('project-loading')).toBeTruthy();
  });

  it('shows not-found state when fetch returns 404', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'Not Found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as any;
    render(<ProjectDetail projectId="p-missing" />);
    await waitFor(() => {
      expect(screen.getByTestId('project-not-found')).toBeTruthy();
    });
  });

  it('submits a new task via POST', async () => {
    const fetchSpy = vi
      .fn()
      // list (initialData not used here) — not needed
      .mockResolvedValueOnce(
        new Response(JSON.stringify(projectFixture), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      // create task
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'task-new',
            projectId: 'p-1',
            title: 'New task',
            status: 'TODO',
            priority: 'MEDIUM',
            createdAt: '2026-01-02T00:00:00.000Z',
            updatedAt: '2026-01-02T00:00:00.000Z',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    globalThis.fetch = fetchSpy as any;
    render(<ProjectDetail projectId="p-1" />);
    await waitFor(() => {
      expect(screen.getAllByTestId('project-task-row')).toHaveLength(2);
    });

    fireEvent.change(screen.getByTestId('project-task-title'), {
      target: { value: 'New task' },
    });
    fireEvent.click(screen.getByTestId('project-task-submit'));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/projects/p-1/tasks',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    await waitFor(() => {
      expect(screen.getAllByTestId('project-task-row')).toHaveLength(3);
    });
  });

  it('changes task status optimistically and PATCHes the new status', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    globalThis.fetch = fetchSpy as any;
    render(<ProjectDetail projectId="p-1" initialData={projectFixture} />);

    const selects = screen.getAllByTestId('project-task-status') as HTMLSelectElement[];
    fireEvent.change(selects[0]!, { target: { value: 'DONE' } });

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/projects/p-1/tasks/task-1/status',
        expect.objectContaining({ method: 'PATCH' }),
      );
    });
    // optimistic update: select now reflects the new status
    expect((selects[0] as HTMLSelectElement).value).toBe('DONE');
  });

  it('reverts the optimistic status update when PATCH fails', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'server error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    globalThis.fetch = fetchSpy as any;
    render(<ProjectDetail projectId="p-1" initialData={projectFixture} />);

    const selects = screen.getAllByTestId('project-task-status') as HTMLSelectElement[];
    const originalValue = selects[0]!.value;
    fireEvent.change(selects[0]!, { target: { value: 'DONE' } });

    await waitFor(() => {
      expect(screen.getByTestId('project-error')).toBeTruthy();
    });
    expect((selects[0] as HTMLSelectElement).value).toBe(originalValue);
  });

  it('deletes a task after confirm', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'task-1', deleted: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    globalThis.fetch = fetchSpy as any;
    render(<ProjectDetail projectId="p-1" initialData={projectFixture} />);

    const deleteButtons = screen.getAllByTestId('project-task-delete');
    fireEvent.click(deleteButtons[0]!);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/projects/p-1/tasks/task-1',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
    await waitFor(() => {
      expect(screen.getAllByTestId('project-task-row')).toHaveLength(1);
    });
  });

  it('does not delete when user cancels confirm', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as any;
    render(<ProjectDetail projectId="p-1" initialData={projectFixture} />);

    const deleteButtons = screen.getAllByTestId('project-task-delete');
    fireEvent.click(deleteButtons[0]!);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.getAllByTestId('project-task-row')).toHaveLength(2);
  });

  it('shows error banner when delete fails', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as any;
    render(<ProjectDetail projectId="p-1" initialData={projectFixture} />);

    const deleteButtons = screen.getAllByTestId('project-task-delete');
    fireEvent.click(deleteButtons[0]!);

    await waitFor(() => {
      expect(screen.getByTestId('project-error').textContent).toMatch(/forbidden/i);
    });
    // row still present (no removal on failure)
    expect(screen.getAllByTestId('project-task-row')).toHaveLength(2);
  });

  it('create task button is disabled when title is empty', () => {
    render(<ProjectDetail projectId="p-1" initialData={projectFixture} />);
    const btn = screen.getByTestId('project-task-submit') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('shows error when create task fails', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'Bad request' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as any;
    render(<ProjectDetail projectId="p-1" initialData={projectFixture} />);

    fireEvent.change(screen.getByTestId('project-task-title'), {
      target: { value: 'New task' },
    });
    fireEvent.click(screen.getByTestId('project-task-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('project-error').textContent).toMatch(/bad request/i);
    });
  });

  it('shows error banner when initial fetch fails', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'Network down' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as any;
    render(<ProjectDetail projectId="p-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('project-error').textContent).toMatch(
        /network down/i,
      );
    });
  });
});