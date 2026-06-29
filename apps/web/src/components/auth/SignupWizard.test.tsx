import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SignupWizard } from './SignupWizard';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    api: {
      ...actual.api,
      auth: { ...actual.api.auth, signup: vi.fn() },
      invites: { send: vi.fn() },
    },
  };
});
import { api } from '@/lib/api';

const fakeSession = {
  user: { id: 'u1', email: 'alice@example.com', name: 'Alice' },
  tenant: { id: 't1', slug: 'acme', name: 'Acme Corp', role: 'OWNER' as const },
  accessToken: 'tok',
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
};

describe('SignupWizard — Step 1 (workspace)', () => {
  beforeEach(() => {
    vi.mocked(api.auth.signup).mockReset();
    vi.mocked(api.invites.send).mockReset();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, href: '' },
      writable: true,
      configurable: true,
    });
  });

  it('renders the workspace form on initial mount', () => {
    render(<SignupWizard />);
    expect(screen.getByTestId('signup-wizard')).toBeInTheDocument();
    expect(screen.getByTestId('signup-step-workspace')).toBeInTheDocument();
    expect(screen.getByTestId('signup-stepper')).toBeInTheDocument();
  });

  it('surfaces validation errors for missing fields', async () => {
    render(<SignupWizard />);
    await userEvent.click(screen.getByTestId('signup-submit'));
    const errors = await screen.findAllByTestId('signup-field-error');
    expect(errors.length).toBeGreaterThan(0);
    expect(api.auth.signup).not.toHaveBeenCalled();
  });

  it('blocks submission with an invalid email', async () => {
    render(<SignupWizard />);
    await userEvent.type(screen.getByTestId('signup-input-name'), 'Alice');
    await userEvent.type(screen.getByTestId('signup-input-email'), 'not-an-email');
    await userEvent.type(screen.getByTestId('signup-input-password'), 'password123');
    await userEvent.type(screen.getByTestId('signup-input-tenant'), 'Acme');
    await userEvent.click(screen.getByTestId('signup-submit'));
    expect(await screen.findByText(/valid email/i)).toBeInTheDocument();
    expect(api.auth.signup).not.toHaveBeenCalled();
  });

  it('blocks submission with a short password', async () => {
    render(<SignupWizard />);
    await userEvent.type(screen.getByTestId('signup-input-name'), 'Alice');
    await userEvent.type(screen.getByTestId('signup-input-email'), 'a@b.com');
    await userEvent.type(screen.getByTestId('signup-input-password'), 'short');
    await userEvent.type(screen.getByTestId('signup-input-tenant'), 'Acme');
    await userEvent.click(screen.getByTestId('signup-submit'));
    expect(await screen.findByText(/at least 8 characters/i)).toBeInTheDocument();
  });

  it('submits /api/auth/signup and advances to invite step on success', async () => {
    vi.mocked(api.auth.signup).mockResolvedValue(fakeSession);
    render(<SignupWizard />);
    await userEvent.type(screen.getByTestId('signup-input-name'), 'Alice');
    await userEvent.type(screen.getByTestId('signup-input-email'), 'a@b.com');
    await userEvent.type(screen.getByTestId('signup-input-password'), 'password123');
    await userEvent.type(screen.getByTestId('signup-input-tenant'), 'Acme');
    await userEvent.click(screen.getByTestId('signup-submit'));

    await waitFor(() => {
      expect(api.auth.signup).toHaveBeenCalledWith({
        email: 'a@b.com',
        password: 'password123',
        name: 'Alice',
        tenantName: 'Acme',
        locale: 'en',
      });
      expect(screen.getByTestId('signup-step-invite')).toBeInTheDocument();
    });
  });

  it('surfaces API errors from signup', async () => {
    vi.mocked(api.auth.signup).mockRejectedValue(new Error('email taken'));
    render(<SignupWizard />);
    await userEvent.type(screen.getByTestId('signup-input-name'), 'Alice');
    await userEvent.type(screen.getByTestId('signup-input-email'), 'a@b.com');
    await userEvent.type(screen.getByTestId('signup-input-password'), 'password123');
    await userEvent.type(screen.getByTestId('signup-input-tenant'), 'Acme');
    await userEvent.click(screen.getByTestId('signup-submit'));

    const err = await screen.findByTestId('signup-error');
    expect(err).toHaveTextContent('email taken');
    // Did not advance
    expect(screen.getByTestId('signup-step-workspace')).toBeInTheDocument();
  });
});

describe('SignupWizard — Step 2 (invite)', () => {
  beforeEach(() => {
    vi.mocked(api.auth.signup).mockReset();
    vi.mocked(api.invites.send).mockReset();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, href: '' },
      writable: true,
      configurable: true,
    });
  });

  async function advanceToInvite() {
    vi.mocked(api.auth.signup).mockResolvedValue(fakeSession);
    render(<SignupWizard />);
    await userEvent.type(screen.getByTestId('signup-input-name'), 'Alice');
    await userEvent.type(screen.getByTestId('signup-input-email'), 'a@b.com');
    await userEvent.type(screen.getByTestId('signup-input-password'), 'password123');
    await userEvent.type(screen.getByTestId('signup-input-tenant'), 'Acme');
    await userEvent.click(screen.getByTestId('signup-submit'));
    await waitFor(() => screen.getByTestId('signup-step-invite'));
  }

  it('skips invites and goes to done', async () => {
    await advanceToInvite();
    await userEvent.click(screen.getByTestId('invite-skip'));
    expect(screen.getByTestId('signup-step-done')).toBeInTheDocument();
    expect(api.invites.send).not.toHaveBeenCalled();
  });

  it('adds invite rows and validates them', async () => {
    await advanceToInvite();
    await userEvent.click(screen.getByTestId('invite-add'));
    await userEvent.click(screen.getByTestId('invite-add'));
    const rows = screen.getAllByTestId(/^invite-row-/);
    expect(rows).toHaveLength(2);
    // bad email
    const firstInput = within(rows[0]).getByRole('textbox');
    await userEvent.type(firstInput, 'bad-email');
    await userEvent.click(screen.getByTestId('invite-submit'));
    // Wait for form validation to render an error within the bad row
    const errorEl = await within(rows[0]).findByText(/valid email/i);
    expect(errorEl).toBeInTheDocument();
    expect(api.invites.send).not.toHaveBeenCalled();
  });

  it('removes an invite row', async () => {
    await advanceToInvite();
    await userEvent.click(screen.getByTestId('invite-add'));
    await userEvent.click(screen.getByTestId('invite-add'));
    expect(screen.getAllByTestId(/^invite-row-/)).toHaveLength(2);
    await userEvent.click(screen.getByTestId('invite-remove-1'));
    expect(screen.getAllByTestId(/^invite-row-/)).toHaveLength(1);
  });

  it('sends invites and reaches the done step with status', async () => {
    vi.mocked(api.invites.send).mockResolvedValue({ sent: 2 });
    await advanceToInvite();
    await userEvent.click(screen.getByTestId('invite-add'));
    await userEvent.click(screen.getByTestId('invite-add'));
    const inputs = screen.getAllByTestId(/^invite-input-/);
    await userEvent.type(inputs[0] as HTMLElement, 'b@example.com');
    await userEvent.type(inputs[1] as HTMLElement, 'c@example.com');
    await userEvent.click(screen.getByTestId('invite-submit'));

    await waitFor(() => {
      expect(api.invites.send).toHaveBeenCalledWith({
        emails: ['b@example.com', 'c@example.com'],
      });
      expect(screen.getByTestId('signup-step-done')).toBeInTheDocument();
      expect(screen.getByTestId('signup-invite-status')).toHaveTextContent('Sent 2 invitations');
    });
  });

  it('surfaces API errors from /api/invites', async () => {
    vi.mocked(api.invites.send).mockRejectedValue(new Error('mail service down'));
    await advanceToInvite();
    await userEvent.click(screen.getByTestId('invite-add'));
    const input = screen.getByTestId('invite-input-0');
    await userEvent.type(input, 'b@example.com');
    await userEvent.click(screen.getByTestId('invite-submit'));

    const err = await screen.findByTestId('invite-error');
    expect(err).toHaveTextContent('mail service down');
    expect(screen.getByTestId('signup-step-invite')).toBeInTheDocument();
  });
});

describe('SignupWizard — Step 3 (done)', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      value: { ...window.location, href: '' },
      writable: true,
      configurable: true,
    });
  });

  it('renders the welcome screen with tenant name and CTAs', () => {
    render(<SignupWizard initialStep="done" />);
    expect(screen.getByTestId('signup-step-done')).toBeInTheDocument();
    // CTAs are present (one for "Go to dashboard", one for "Enable MFA")
    const links = screen.getAllByTestId(/signup-go-/);
    expect(links.length).toBeGreaterThanOrEqual(2);
  });

  it('clicking Go to dashboard redirects to dashboardHref', async () => {
    const hrefSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      value: {
        ...window.location,
        set href(v: string) {
          hrefSpy(v);
        },
      },
      writable: true,
      configurable: true,
    });

    render(<SignupWizard initialStep="done" dashboardHref="/welcome" />);
    await userEvent.click(screen.getByTestId('signup-go-dashboard'));
    expect(hrefSpy).toHaveBeenCalledWith('/welcome');
  });

  it('clicking Enable MFA redirects to /mfa/enroll', async () => {
    const hrefSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      value: {
        ...window.location,
        set href(v: string) {
          hrefSpy(v);
        },
      },
      writable: true,
      configurable: true,
    });

    render(<SignupWizard initialStep="done" />);
    await userEvent.click(screen.getByTestId('signup-go-mfa'));
    expect(hrefSpy).toHaveBeenCalledWith('/mfa/enroll');
  });
});
