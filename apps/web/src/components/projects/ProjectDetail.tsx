'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError, type Project, type ProjectTask } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Input';

const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE'] as const;
const TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;

interface Props {
  projectId: string;
  initialData?: Project;
}

/**
 * ProjectDetail — minimal viable project detail with nested tasks.
 *
 * - Fetches /projects/:id (which already includes tasks) on mount.
 * - Inline create task form.
 * - Per-row quick status change + delete.
 */
export function ProjectDetail({ projectId, initialData }: Props) {
  const [project, setProject] = useState<Project | null>(initialData ?? null);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<string>('MEDIUM');
  const [submitting, setSubmitting] = useState(false);

  const refresh = async () => {
    setLoading(true);
    setNotFound(false);
    setError(null);
    try {
      const data = await api.projects.get(projectId);
      setProject(data);
    } catch (e: unknown) {
      if (e instanceof ApiError && e.status === 404) {
        setNotFound(true);
      } else {
        setError(e instanceof ApiError ? e.message : 'Failed to load');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialData) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await api.projects.createTask(projectId, {
        title: title.trim(),
        priority,
      });
      setProject((prev) =>
        prev ? { ...prev, tasks: [created, ...(prev.tasks ?? [])] } : prev,
      );
      setTitle('');
      setPriority('MEDIUM');
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : 'Failed to create task');
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusChange = async (task: ProjectTask, next: string) => {
    // optimistic update
    setProject((prev) =>
      prev
        ? {
            ...prev,
            tasks: (prev.tasks ?? []).map((t) =>
              t.id === task.id ? { ...t, status: next } : t,
            ),
          }
        : prev,
    );
    try {
      await api.projects.updateTaskStatus(projectId, task.id, next);
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : 'Failed to update status');
      // revert
      setProject((prev) =>
        prev
          ? {
              ...prev,
              tasks: (prev.tasks ?? []).map((t) =>
                t.id === task.id ? { ...t, status: task.status } : t,
              ),
            }
          : prev,
      );
    }
  };

  const handleDeleteTask = async (task: ProjectTask) => {
    if (!confirm(`Delete task "${task.title}"?`)) return;
    try {
      await api.projects.deleteTask(projectId, task.id);
      setProject((prev) =>
        prev
          ? { ...prev, tasks: (prev.tasks ?? []).filter((t) => t.id !== task.id) }
          : prev,
      );
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : 'Failed to delete task');
    }
  };

  if (loading && !project) {
    return <div data-testid="project-loading">Loading project...</div>;
  }

  if (notFound && !project) {
    return (
      <div data-testid="project-not-found" className="space-y-2">
        <p className="text-sm">Project not found.</p>
        <Link href="/projects" className="text-sm underline">
          ← Back to projects
        </Link>
      </div>
    );
  }

  if (!project) {
    return (
      <div data-testid="project-error-wrapper" className="space-y-2">
        <div data-testid="project-error" className="text-sm text-destructive">
          {error || 'Failed to load project'}
        </div>
        <Link href="/projects" className="text-sm underline">
          ← Back to projects
        </Link>
      </div>
    );
  }

  const tasks = project.tasks ?? [];

  return (
    <div data-testid="project-detail" className="space-y-6">
      <div>
        <Link
          href="/projects"
          className="text-sm text-muted-foreground underline"
          data-testid="project-back"
        >
          ← All projects
        </Link>
        <h1 data-testid="project-name" className="mt-2 text-2xl font-semibold">
          {project.name}
        </h1>
        {project.description && (
          <p data-testid="project-description" className="mt-1 text-sm text-muted-foreground">
            {project.description}
          </p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">Status: {project.status}</p>
      </div>

      {error && (
        <div data-testid="project-error" className="text-sm text-destructive">
          {error}
        </div>
      )}

      <form
        data-testid="project-task-form"
        onSubmit={handleCreateTask}
        className="space-y-3 rounded-md border p-4"
      >
        <h2 className="text-lg font-semibold">Add task</h2>
        <div className="space-y-1">
          <Label htmlFor="task-title">Title</Label>
          <Input
            id="task-title"
            data-testid="project-task-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="task-priority">Priority</Label>
          <select
            id="task-priority"
            data-testid="project-task-priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <Button
          type="submit"
          disabled={submitting || !title.trim()}
          data-testid="project-task-submit"
        >
          {submitting ? 'Adding...' : 'Add task'}
        </Button>
      </form>

      {tasks.length === 0 ? (
        <div data-testid="project-tasks-empty" className="rounded-md border p-6 text-center text-sm">
          No tasks yet. Add one above.
        </div>
      ) : (
        <ul data-testid="project-tasks-list" className="space-y-2">
          {tasks.map((t) => (
            <li
              key={t.id}
              data-testid="project-task-row"
              className="flex items-center justify-between rounded-md border p-3"
            >
              <div className="flex-1">
                <p className="font-medium" data-testid="project-task-title-text">
                  {t.title}
                </p>
                <p className="text-xs text-muted-foreground">
                  Priority: {t.priority}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  aria-label="task-status"
                  data-testid="project-task-status"
                  value={t.status}
                  onChange={(e) => handleStatusChange(t, e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                >
                  {TASK_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <Button
                  variant="destructive"
                  size="sm"
                  data-testid="project-task-delete"
                  onClick={() => handleDeleteTask(t)}
                >
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}