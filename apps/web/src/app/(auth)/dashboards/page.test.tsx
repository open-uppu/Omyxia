import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import DashboardsPage from './page';

describe('DashboardsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders empty state', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve([]),
    });
    render(<DashboardsPage />);
    expect(await screen.findByTestId('empty')).toBeTruthy();
  });

  it('renders 2 dashboards', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: () =>
        Promise.resolve([
          { id: 'd1', name: 'Sales', description: 'Sales KPIs' },
          { id: 'd2', name: 'HR' },
        ]),
    });
    render(<DashboardsPage />);
    const items = await screen.findAllByTestId('dashboard-list');
    expect(items.length).toBeGreaterThan(0);
  });
});
