'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface AuditRow {
  id: string;
  createdAt: string;
  userId: string | null;
  table: string;
  rowId: string | null;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  before: unknown;
  after: unknown;
}

interface AuditListResponse {
  items: AuditRow[];
  total: number;
}

const TABLES = ['', 'crm/leads', 'hrm/employees', 'erp/invoices', 'auth/users'] as const;
const ACTIONS = ['', 'CREATE', 'UPDATE', 'DELETE'] as const;

export function AuditLogTable({ initialData }: { initialData?: AuditListResponse }) {
  const [data, setData] = useState<AuditListResponse>(
    initialData ?? { items: [], total: 0 },
  );
  const [table, setTable] = useState<string>('');
  const [action, setAction] = useState<string>('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (initialData) return; // skip fetch on SSR-provided data
    setLoading(true);
    const params = new URLSearchParams();
    if (table) params.set('table', table);
    if (action) params.set('action', action);
    fetch(`/api/audit-logs?${params.toString()}`)
      .then((r) => r.json() as Promise<AuditListResponse>)
      .then(setData)
      .finally(() => setLoading(false));
  }, [table, action, initialData]);

  if (loading && data.items.length === 0) {
    return <div data-testid="audit-loading">Loading...</div>;
  }
  if (data.items.length === 0) {
    return <div data-testid="audit-empty">No audit events found.</div>;
  }
  return (
    <div data-testid="audit-table" className="space-y-2">
      <div className="flex gap-2">
        <select
          aria-label="filter-table"
          value={table}
          onChange={(e) => setTable(e.target.value)}
          className="border rounded px-2 py-1"
        >
          {TABLES.map((t) => (
            <option key={t} value={t}>
              {t || 'All tables'}
            </option>
          ))}
        </select>
        <select
          aria-label="filter-action"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          className="border rounded px-2 py-1"
        >
          {ACTIONS.map((a) => (
            <option key={a} value={a}>
              {a || 'All actions'}
            </option>
          ))}
        </select>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left">
            <th></th>
            <th>Time</th>
            <th>User</th>
            <th>Table</th>
            <th>Row</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((row) => (
            <>
              <tr key={row.id} data-testid="audit-row">
                <td>
                  <button
                    aria-label="expand"
                    onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                  >
                    {expanded === row.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                </td>
                <td>{new Date(row.createdAt).toLocaleString()}</td>
                <td>{row.userId ?? '—'}</td>
                <td>{row.table}</td>
                <td>{row.rowId ?? '—'}</td>
                <td>{row.action}</td>
              </tr>
              {expanded === row.id && (
                <tr data-testid="audit-diff">
                  <td colSpan={6} className="bg-muted/30 p-2 font-mono text-xs">
                    <div>before: {JSON.stringify(row.before)}</div>
                    <div>after: {JSON.stringify(row.after)}</div>
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
      <div className="text-xs text-muted-foreground">{data.total} total</div>
    </div>
  );
}
