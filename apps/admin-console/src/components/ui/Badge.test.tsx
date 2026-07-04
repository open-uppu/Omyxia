import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from './Badge';

describe('Badge', () => {
  it('renders the default variant', () => {
    render(<Badge>Default</Badge>);
    const b = screen.getByText('Default');
    expect(b.className).toMatch(/bg-primary/);
  });

  it('renders the success variant', () => {
    render(<Badge variant="success">Active</Badge>);
    const b = screen.getByText('Active');
    expect(b.className).toMatch(/emerald/);
  });

  it('renders the warning variant', () => {
    render(<Badge variant="warning">Dev</Badge>);
    const b = screen.getByText('Dev');
    expect(b.className).toMatch(/amber/);
  });
});