'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError, type DocumentTemplate } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Input';

interface Props {
  templateId: string;
  initialData?: DocumentTemplate;
}

const PLACEHOLDER_RE = /\{\{\{?([a-zA-Z_][a-zA-Z0-9_]{0,63})\}?\}\}/g;

/**
 * TemplateRenderer — minimal viable render preview.
 *
 * - Loads the template body on mount.
 * - Derives the variable list (regex scan of `{{var}}` / `{{{var}}}`).
 * - Lets the user fill in values, then posts to /docs/templates/:id/render
 *   and shows the sanitized result in an iframe (so raw HTML never lands
 *   in our React tree).
 */
export function TemplateRenderer({ templateId, initialData }: Props) {
  const [template, setTemplate] = useState<DocumentTemplate | null>(initialData ?? null);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [values, setValues] = useState<Record<string, string>>({});
  const [renderedHtml, setRenderedHtml] = useState<string>('');
  const [rendering, setRendering] = useState(false);

  useEffect(() => {
    if (initialData) return;
    setLoading(true);
    setNotFound(false);
    setError(null);
    api.templates
      .get(templateId)
      .then((data) => {
        setTemplate(data);
      })
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 404) {
          setNotFound(true);
        } else {
          setError(e instanceof ApiError ? e.message : 'Failed to load');
        }
      })
      .finally(() => setLoading(false));
  }, [initialData, templateId]);

  if (loading && !template) {
    return <div data-testid="template-loading">Loading template...</div>;
  }
  if (notFound && !template) {
    return (
      <div data-testid="template-not-found" className="space-y-2">
        <p className="text-sm">Template not found.</p>
        <Link href="/docs/templates" className="text-sm underline">
          ← Back to templates
        </Link>
      </div>
    );
  }
  if (!template) {
    return (
      <div data-testid="template-error-wrapper" className="space-y-2">
        <div data-testid="template-error" className="text-sm text-destructive">
          {error || 'Failed to load template'}
        </div>
        <Link href="/docs/templates" className="text-sm underline">
          ← Back to templates
        </Link>
      </div>
    );
  }

  // Derive variable names from the body. Order of first appearance is
  // preserved so the form mirrors the template narrative.
  const derivedVars: string[] = [];
  const seen = new Set<string>();
  for (const m of template.bodyHtml.matchAll(PLACEHOLDER_RE)) {
    const name = m[1];
    if (!name) continue;
    if (!seen.has(name)) {
      seen.add(name);
      derivedVars.push(name);
    }
  }
  // Merge with explicitly declared variables (declarations may pre-declare
  // variables that haven't appeared yet).
  for (const v of template.variables ?? []) {
    if (!seen.has(v)) {
      seen.add(v);
      derivedVars.push(v);
    }
  }

  const handleRender = async (e: React.FormEvent) => {
    e.preventDefault();
    setRendering(true);
    setError(null);
    try {
      const result = await api.templates.render(templateId, values);
      setRenderedHtml(result.renderedHtml);
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : 'Failed to render');
    } finally {
      setRendering(false);
    }
  };

  return (
    <div data-testid="template-renderer" className="space-y-6">
      <div>
        <Link
          href="/docs/templates"
          className="text-sm text-muted-foreground underline"
          data-testid="template-back"
        >
          ← All templates
        </Link>
        <h1 data-testid="template-name" className="mt-2 text-2xl font-semibold">
          {template.name}
        </h1>
        {template.category && (
          <p className="mt-1 text-xs text-muted-foreground">
            Category: {template.category}
          </p>
        )}
      </div>

      {error && (
        <div data-testid="template-error" className="text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Variables</h2>
          {derivedVars.length === 0 ? (
            <p data-testid="template-no-vars" className="text-sm text-muted-foreground">
              This template has no variables.
            </p>
          ) : (
            <form
              data-testid="template-render-form"
              onSubmit={handleRender}
              className="space-y-3"
            >
              {derivedVars.map((name) => (
                <div key={name} className="space-y-1">
                  <Label htmlFor={`var-${name}`}>{name}</Label>
                  <Input
                    id={`var-${name}`}
                    data-testid={`template-var-${name}`}
                    value={values[name] ?? ''}
                    onChange={(e) =>
                      setValues((prev) => ({ ...prev, [name]: e.target.value }))
                    }
                  />
                </div>
              ))}
              <Button type="submit" disabled={rendering} data-testid="template-render-submit">
                {rendering ? 'Rendering...' : 'Render'}
              </Button>
            </form>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Rendered preview</h2>
          {renderedHtml ? (
            <iframe
              data-testid="template-preview-frame"
              title="Template preview"
              srcDoc={renderedHtml}
              sandbox=""
              className="h-96 w-full rounded-md border bg-white"
            />
          ) : (
            <div
              data-testid="template-preview-empty"
              className="rounded-md border p-6 text-center text-sm text-muted-foreground"
            >
              Fill in the variables and click Render.
            </div>
          )}
        </section>
      </div>

      <details data-testid="template-source-details" className="rounded-md border p-3">
        <summary className="cursor-pointer text-sm font-medium">Source HTML</summary>
        <pre
          data-testid="template-source"
          className="mt-2 overflow-x-auto rounded bg-muted p-2 text-xs"
        >
          {template.bodyHtml}
        </pre>
      </details>
    </div>
  );
}