import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './Button';

describe('Button', () => {
  it('renders a <button> by default with merged classes', () => {
    render(<Button variant="destructive">Delete</Button>);
    const btn = screen.getByRole('button', { name: 'Delete' });
    expect(btn.tagName).toBe('BUTTON');
    // destructive variant class is present
    expect(btn.className).toMatch(/bg-destructive/);
  });

  it('forwards click events and ref', async () => {
    const onClick = vi.fn();
    let captured: HTMLButtonElement | null = null;
    render(
      <Button
        onClick={onClick}
        ref={(node) => {
          captured = node;
        }}
      >
        Click me
      </Button>
    );
    const btn = screen.getByRole('button', { name: 'Click me' });
    await userEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(captured).toBe(btn);
  });

  it('defaults `type` to "button" so it does not accidentally submit forms', () => {
    render(
      <form>
        <Button>Submit guard</Button>
      </form>
    );
    const btn = screen.getByRole('button', { name: 'Submit guard' });
    expect(btn).toHaveAttribute('type', 'button');
  });

  it('asChild merges classes and props into a single child element', async () => {
    const onClick = vi.fn();
    render(
      <Button asChild variant="outline" className="extra-class" onClick={onClick}>
        <a href="/x">Link text</a>
      </Button>
    );
    const link = screen.getByText('Link text');
    expect(link.tagName).toBe('A');
    // Both classes from default + variant + extra prop are merged in
    expect(link.className).toMatch(/inline-flex/);
    expect(link.className).toMatch(/border/);
    expect(link.className).toMatch(/extra-class/);
    // Click is forwarded
    fireEvent.click(link);
    expect(onClick).toHaveBeenCalled();
  });

  it('renders the lg and icon sizes with their respective classes', () => {
    const { rerender } = render(<Button size="lg">Large</Button>);
    expect(screen.getByRole('button').className).toMatch(/h-11/);
    rerender(<Button size="icon">↥</Button>);
    expect(screen.getByRole('button').className).toMatch(/h-10 w-10/);
  });

  it('respects disabled attribute', () => {
    render(<Button disabled>Off</Button>);
    expect(screen.getByRole('button', { name: 'Off' })).toBeDisabled();
  });
});
