// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dialog, DialogTitle, DialogBody, DialogFooter, DialogCloseButton, DialogHeader, DialogDescription } from './Dialog';
import { useState } from 'react';

afterEach(() => cleanup());

function ControlledDialog({
  initialOpen = true,
  dismissible = true,
}: {
  initialOpen?: boolean;
  dismissible?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <Dialog open={open} onOpenChange={setOpen} dismissible={dismissible}>
      <DialogHeader>
        <DialogTitle>Hello</DialogTitle>
        <DialogDescription>Dialog description</DialogDescription>
        <DialogCloseButton>×</DialogCloseButton>
      </DialogHeader>
      <DialogBody>
        <button>Focusable inside</button>
      </DialogBody>
      <DialogFooter>
        <button onClick={() => setOpen(false)}>Done</button>
      </DialogFooter>
    </Dialog>
  );
}

describe('Dialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders the role=dialog when open', () => {
    render(<ControlledDialog />);
    const dlg = screen.getByRole('dialog');
    expect(dlg).toBeDefined();
    expect(dlg.getAttribute('aria-modal')).toBe('true');
  });

  it('Esc closes a dismissible dialog', async () => {
    const user = userEvent.setup();
    render(<ControlledDialog />);
    expect(screen.queryByRole('dialog')).not.toBeNull();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Esc does NOT close a non-dismissible dialog', async () => {
    const user = userEvent.setup();
    render(<ControlledDialog dismissible={false} />);
    expect(screen.queryByRole('dialog')).not.toBeNull();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeNull();
  });

  it('backdrop click closes a dismissible dialog', async () => {
    const user = userEvent.setup();
    render(<ControlledDialog />);
    const backdrop = screen.getByTestId('dialog-backdrop');
    await user.click(backdrop);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not render when closed', () => {
    render(<ControlledDialog initialOpen={false} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
