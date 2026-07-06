import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './Button';

describe('Button', () => {
  it('renders with the destructive variant classes', () => {
    render(<Button variant="destructive">Delete</Button>);
    const btn = screen.getByRole('button', { name: 'Delete' });
    expect(btn.className).toMatch(/bg-destructive/);
  });

  it('renders with the ghost variant classes', () => {
    render(<Button variant="ghost">Cancel</Button>);
    const btn = screen.getByRole('button', { name: 'Cancel' });
    expect(btn.className).toMatch(/hover:bg-accent/);
  });

  it('is disabled when the disabled prop is true', () => {
    render(<Button disabled>Sign in</Button>);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
  });

  it('forwards click events', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Click</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Click' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders an icon-sized button (square)', () => {
    render(<Button size="icon" aria-label="menu"><span /></Button>);
    const btn = screen.getByRole('button', { name: 'menu' });
    expect(btn.className).toMatch(/h-10 w-10/);
  });
});