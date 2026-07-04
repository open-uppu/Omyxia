/**
 * StatCard tests — pure React. Cover the render contract:
 *  - shows the label and value
 *  - shows the delta chip in the expected tone
 *  - renders a skeleton when `loading` is true
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatCard } from './StatCard';

describe('StatCard', () => {
  it('renders the label and large value', () => {
    render(<StatCard label="Tenants" value="248" testId="stat-tenants" />);
    const card = screen.getByTestId('stat-tenants');
    expect(card).toBeInTheDocument();
    expect(screen.getByTestId('stat-tenants-value')).toHaveTextContent('248');
    expect(card).toHaveTextContent('Tenants');
  });

  it('shows the up-tone delta chip when delta.label is positive', () => {
    render(
      <StatCard
        label="Tenants"
        value="248"
        testId="stat-tenants"
        delta={{ label: '+7', tone: 'up', caption: 'last 7 days' }}
      />
    );
    expect(screen.getByText('+7')).toBeInTheDocument();
    expect(screen.getByText('last 7 days')).toBeInTheDocument();
  });

  it('renders a skeleton instead of the value when loading', () => {
    render(<StatCard label="Tenants" value="248" testId="stat-tenants" loading />);
    expect(screen.queryByTestId('stat-tenants-value')).toBeNull();
    expect(screen.getByTestId('stat-tenants-skeleton')).toBeInTheDocument();
  });

  it('renders the footer slot when provided', () => {
    render(
      <StatCard
        label="MRR"
        value="$2,900"
        testId="stat-mrr"
        footer={<span data-testid="mrr-footer">Pro · Enterprise</span>}
      />
    );
    expect(screen.getByTestId('mrr-footer')).toBeInTheDocument();
  });
});
