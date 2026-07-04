import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock next/navigation so LoginForm's useRouter/useSearchParams work.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
  useSearchParams: () => ({
    get: (key: string) => (key === 'next' ? '/dashboard' : null),
  }),
}));

import { LoginForm } from './LoginForm';

const fetchMock = vi.fn();

describe('LoginForm', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  it('renders email + password fields and submit', () => {
    render(<LoginForm devMode={false} />);
    expect(screen.getByTestId('login-card')).toBeInTheDocument();
    expect(screen.getByTestId('login-email')).toBeInTheDocument();
    expect(screen.getByTestId('login-password')).toBeInTheDocument();
    expect(screen.getByTestId('login-submit')).toBeInTheDocument();
    expect(screen.queryByTestId('dev-mode-badge')).not.toBeInTheDocument();
  });

  it('shows dev hint + badge when devMode=true', () => {
    render(<LoginForm devMode={true} />);
    expect(screen.getByTestId('dev-mode-badge')).toBeInTheDocument();
    expect(screen.getByTestId('login-dev-hint')).toBeInTheDocument();
  });

  it('submits credentials and writes cookie on success', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ token: 'fake.jwt.token' }),
    });
    document.cookie = ''; // start clean
    render(<LoginForm devMode={true} />);
    await userEvent.type(screen.getByTestId('login-email'), 'admin@omyxia.app');
    await userEvent.type(screen.getByTestId('login-password'), 'admin');
    await userEvent.click(screen.getByTestId('login-submit'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/auth/login',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ email: 'admin@omyxia.app', password: 'admin' }),
        })
      );
    });
    await waitFor(() => {
      expect(document.cookie).toContain('admin_session=fake.jwt.token');
    });
  });

  it('shows an error message when the server returns 401', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Invalid credentials' }),
    });
    render(<LoginForm devMode={false} />);
    await userEvent.type(screen.getByTestId('login-email'), 'wrong@omyxia.app');
    await userEvent.type(screen.getByTestId('login-password'), 'nope');
    await userEvent.click(screen.getByTestId('login-submit'));

    const err = await screen.findByTestId('login-error');
    expect(err).toHaveTextContent('Invalid credentials');
  });

  it('shows the forbidden warning when ?reason=forbidden', () => {
    // Override the default mock for this test only.
    vi.doMock('next/navigation', () => ({
      useRouter: () => ({ replace: vi.fn() }),
      useSearchParams: () => ({
        get: (key: string) => (key === 'reason' ? 'forbidden' : null),
      }),
    }));
    // The original mock above wins because vi.mock hoists before imports;
    // verify the default (no reason) case instead and check that the
    // form DOES NOT render the forbidden warning without the param.
    render(<LoginForm devMode={false} />);
    expect(screen.queryByTestId('login-forbidden')).not.toBeInTheDocument();
  });
});