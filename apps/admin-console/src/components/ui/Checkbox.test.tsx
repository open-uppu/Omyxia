// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Checkbox } from './Checkbox';

describe('Checkbox', () => {
  it('renders a bare checkbox (no label)', () => {
    render(<Checkbox aria-label="Bare" data-testid="c" />);
    const c = screen.getByTestId('c') as HTMLInputElement;
    expect(c.type).toBe('checkbox');
  });

  it('renders with a label + description and toggles on click', async () => {
    const user = userEvent.setup();
    render(
      <Checkbox
        label="CRM"
        description="Customer relationship"
        data-testid="c"
      />
    );
    const input = screen.getByTestId('c') as HTMLInputElement;
    expect(input.checked).toBe(false);
    await user.click(screen.getByText('CRM'));
    expect(input.checked).toBe(true);
  });

  it('honors disabled', () => {
    render(<Checkbox label="Locked" disabled data-testid="c" />);
    const input = screen.getByTestId('c') as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });
});
