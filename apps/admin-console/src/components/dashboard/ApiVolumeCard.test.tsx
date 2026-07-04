/**
 * ApiVolumeCard tests — verify the 24h/7d/30d toggle switches the
 * headline number. The sparkline is a Side-effect-free Recharts
 * composition; we don't snapshot its pixels here, only that the
 * pickers behave.
 */

import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ApiVolumeCard } from './ApiVolumeCard';
import type { ApiVolume } from '@omyxia/shared-types';

const sample: ApiVolume = {
  last24h: 1000,
  last7d: 72500, // 72.5K (compact)
  last30d: 250000, // 250K (compact)
  hourlySeries24h: Array.from({ length: 24 }, (_, h) => ({
    hour: new Date(Date.UTC(2026, 6, 4, h)).toISOString(),
    count: 100,
  })),
};

describe('ApiVolumeCard', () => {
  it('renders the 24h window by default', () => {
    render(<ApiVolumeCard apiVolume={sample} />);
    // last24h = 1000 → "1,000" (no compact format for 24h)
    expect(screen.getByTestId('stat-api-value')).toHaveTextContent('1,000');
    // The 24h tab is selected.
    expect(screen.getByTestId('stat-api-window-24h')).toHaveAttribute('aria-selected', 'true');
  });

  it('switches to the 7d value when the user clicks 7d', () => {
    render(<ApiVolumeCard apiVolume={sample} />);
    fireEvent.click(screen.getByTestId('stat-api-window-7d'));
    // 72500 → compact "72.5K" or "72K" depending on locale rounding.
    const valueEl = screen.getByTestId('stat-api-value');
    expect(valueEl.textContent).toMatch(/72(\.5)?K/i);
    expect(screen.getByTestId('stat-api-window-7d')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('stat-api-window-24h')).toHaveAttribute('aria-selected', 'false');
  });

  it('switches to the 30d value when the user clicks 30d', () => {
    render(<ApiVolumeCard apiVolume={sample} />);
    fireEvent.click(screen.getByTestId('stat-api-window-30d'));
    // 250000 → compact "250K"
    expect(screen.getByTestId('stat-api-value').textContent).toMatch(/250K/i);
  });

  it('shows a skeleton under the label when loading', () => {
    render(<ApiVolumeCard apiVolume={sample} loading />);
    expect(screen.getByTestId('stat-api-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('stat-api-value')).toBeNull();
  });
});
