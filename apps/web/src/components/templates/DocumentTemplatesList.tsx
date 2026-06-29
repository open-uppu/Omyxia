'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError, type DocumentTemplate } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input, Label, Textarea } from '@/components/ui/Input';

/**
 * DocumentTemplatesList — minimal viable document template list + create form.
 *
 * - Fetches /docs/templates on mount.
 * - Inline create form posts to /docs/templates and routes to detail page.
 */
export function DocumentTemplatesList({
  initialData,
}: {
  initialData?: DocumentTemplate[];
}) {
  const router = useRouter();
  const [templates, setTemplates] = useState<DocumentTemplate[]>(initialData ?? []);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (initialData) return;
    setLoading(true);
    api.templates
      .list()
      .then((data) => {
        setTemplates(data);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [initialData]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !bodyHtml.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await api.templates.create({
        name: name.trim(),
        category: category.trim() || undefined,
        bodyHtml,
      });
      setTemplates((prev) => [created, ...prev]);
      router.push(`/docs/templates/${encodeURIComponent(created.id)}`);
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : 'Failed to create template');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading && templates.length === 0) {
    return <div data-testid="templates-loading">Loading templates...</div>;
  }

  return (
    <div data-testid="templates-page" className="space-y-6">
      {error && (
        <div data-testid="templates-error" className="text-sm text-destructive">
          {error}
        </div>
      )}

      <form
        data-testid="templates-create-form"
        onSubmit={handleCreate}
        className="space-y-3 rounded-md border p-4"
      >
        <h2 className="text-lg font-semibold">Create template</h2>
        <div className="space-y-1">
          <Label htmlFor="tpl-name">Name</Label>
          <Input
            id="tpl-name"
            data-testid="templates-create-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="NDA — Mutual"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="tpl-category">Category</Label>
          <Input
            id="tpl-category"
            data-testid="templates-create-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Legal"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="tpl-body">Body (HTML)</Label>
          <Textarea
            id="tpl-body"
            data-testid="templates-create-body"
            value={bodyHtml}
            onChange={(e) => setBodyHtml(e.target.value)}
            required
            placeholder="<p>Hello {{party}}, this NDA...</p>"
            rows={6}
            className="font-mono text-xs"
          />
          <p className="text-xs text-muted-foreground">
            Use <code>{'{{var}}'}</code> for escaped values and <code>{'{{{var}}}'}</code> for raw HTML.
          </p>
        </div>
        <Button
          type="submit"
          disabled={submitting || !name.trim() || !bodyHtml.trim()}
          data-testid="templates-create-submit"
        >
          {submitting ? 'Creating...' : 'Create template'}
        </Button>
      </form>

      {templates.length === 0 ? (
        <div
          data-testid="templates-empty"
          className="rounded-md border p-8 text-center text-sm"
        >
          No templates yet. Create your first one above.
        </div>
      ) : (
        <ul data-testid="templates-list" className="space-y-2">
          {templates.map((t) => (
            <li
              key={t.id}
              data-testid="template-card"
              className="rounded-md border p-4 hover:bg-accent"
            >
              <Link
                href={`/docs/templates/${encodeURIComponent(t.id)}`}
                data-testid="template-card-link"
                className="block"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{t.name}</span>
                  {t.category && (
                    <span className="text-xs text-muted-foreground">{t.category}</span>
                  )}
                </div>
                {t.variables && t.variables.length > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Vars: {t.variables.join(', ')}
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