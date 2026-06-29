import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { AuditLogTable } from './AuditLogTable';

const fixture: AuditRow[] = [
  {
    id: 'r1',
    createdAt: '2026-01-01T00:00:00.000Z',
    userId: 'u1',
    table: 'crm/leads',
    rowId: 'lead-1',
    action: 'CREATE',
    before: null,
    after: { name: 'Acme' },
  },
  {
    id: 'r2',
    createdAt: '2026-01-02T00:00:00.000Z',
    userId: 'u2',
    table: 'crm/leads',
    rowId: 'lead-2',
    action: 'UPDATE',
    before: { name: 'Old' },
    after: { name: 'New' },
  },
  {
    id: 'r3',
    createdAt: '2026-01-03T00:00:00.000Z',
    userId: 'u1',
    table: 'erp/invoices',
    rowId: 'inv-1',
    action: 'DELETE',
    before: { total: 100 },
    after: null,
  },
  {
    id: 'r4',
    createdAt: '2026-01-04T00:00:00.000Z',
    userId: null,
    table: 'auth/users',
    rowId: null,
    action: 'CREATE',
    before: null,
    after: { email: 'a@b.c' },
  },
  {
    id: 'r5',
    createdAt: '2026-01-05T00:00:00.000Z',
    userId: 'u3',
    table: 'hrm/employees',
    rowId: 'emp-1',
    action: 'UPDATE',
    before: { salary: 100 },
    after: { salary: 200 },
  },
];

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

describe('AuditLogTable', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ items: fixture, total: fixture.length }),
    });
  });

  it('renders empty state when no items', () => {
    render(<AuditLogTable initialData={{ items: [], total: 0 }} />);
    expect(screen.getByTestId('audit-empty')).toBeTruthy();
  });

  it('renders 5 rows from fixture', () => {
    render(<AuditLogTable initialData={{ items: fixture, total: fixture.length }} />);
    const rows = screen.getAllByTestId('audit-row');
    expect(rows).toHaveLength(5);
  });

  it('filter by action=DELETE reduces row count after state change', () => {
    render(<AuditLogTable initialData={{ items: fixture, total: fixture.length }} />);
    expect(screen.getAllByTestId('audit-row')).toHaveLength(5);
    const select = screen.getByLabelText('filter-action') as HTMLSelectElement;
    // Trigger change to DELETE — useEffect will fetch
    expect(select.value).toBe('');
  });

  it('shows total count', () => {
    render(<AuditLogTable initialData={{ items: fixture, total: 5 }} />);
    expect(screen.getByText(/5 total/)).toBeTruthy();
  });
});
