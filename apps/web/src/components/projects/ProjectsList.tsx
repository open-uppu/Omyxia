'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError, type Project } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input, Label, Textarea } from '@/components/ui/Input';

const STATUS_OPTIONS = ['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED'] as const;

/**
 * ProjectsList — minimal viable project list + create form.
 *
 * - Fetches /projects on mount.
 * - Renders an empty state, loading state, or a list of cards.
 * - Inline create form posts to /projects and refreshes.
 * - Clicking a card navigates to /projects/:id.
 *
 * data-testid hooks are provided for the test suite.
 */
export function ProjectsList({ initialData }: { initialData?: Project[] }) {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>(initialData ?? []);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState<string | null>(null);

  // Create form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<string>('PLANNING');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (initialData) return;
    setLoading(true);
    api.projects
      .list()
      .then((data) => {
        setProjects(data);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [initialData]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await api.projects.create({
        name: name.trim(),
        description: description.trim() || undefined,
        status,
      });
      setProjects((prev) => [created, ...prev]);
      setName('');
      setDescription('');
      setStatus('PLANNING');
      router.push(`/projects/${encodeURIComponent(created.id)}`);
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : 'Failed to create project');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading && projects.length === 0) {
    return <div data-testid="projects-loading">Loading projects...</div>;
  }

  return (
    <div data-testid="projects-page" className="space-y-6">
      {error && (
        <div data-testid="projects-error" className="text-sm text-destructive">
          {error}
        </div>
      )}

      <form
        data-testid="projects-create-form"
        onSubmit={handleCreate}
        className="space-y-3 rounded-md border p-4"
      >
        <h2 className="text-lg font-semibold">Create project</h2>
        <div className="space-y-1">
          <Label htmlFor="project-name">Name</Label>
          <Input
            id="project-name"
            data-testid="projects-create-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="Apollo"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="project-description">Description</Label>
          <Textarea
            id="project-description"
            data-testid="projects-create-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional context for the team"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="project-status">Status</Label>
          <select
            id="project-status"
            data-testid="projects-create-status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <Button
          type="submit"
          variant="default"
          disabled={submitting || !name.trim()}
          data-testid="projects-create-submit"
        >
          {submitting ? 'Creating...' : 'Create project'}
        </Button>
      </form>

      {projects.length === 0 ? (
        <div data-testid="projects-empty" className="rounded-md border p-8 text-center text-sm">
          No projects yet. Create your first one above.
        </div>
      ) : (
        <ul data-testid="projects-list" className="space-y-2">
          {projects.map((p) => (
            <li
              key={p.id}
              data-testid="project-card"
              className="rounded-md border p-4 hover:bg-accent"
            >
              <Link
                href={`/projects/${encodeURIComponent(p.id)}`}
                data-testid="project-card-link"
                className="block"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-xs text-muted-foreground">{p.status}</span>
                </div>
                {p.description && (
                  <p className="mt-1 text-sm text-muted-foreground">{p.description}</p>
                )}
                {p.tasks && p.tasks.length > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {p.tasks.length} task{p.tasks.length === 1 ? '' : 's'}
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}