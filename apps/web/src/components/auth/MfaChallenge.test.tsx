import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MfaChallenge } from './MfaChallenge';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    api: {
      ...actual.api,
      mfa: {
        ...actual.api.mfa,
        verify: vi.fn(),
      },
    },
  };
});
import { api, ApiError } from '@/lib/api';

describe('MfaChallenge', () => {
  beforeEach(() => {
    vi.mocked(api.mfa.verify).mockReset();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, href: '' },
      writable: true,
      configurable: true,
    });
  });

  it('renders TOTP tab active by default with the input field', () => {
    render(<MfaChallenge />);
    expect(screen.getByTestId('mfa-challenge')).toBeInTheDocument();
    expect(screen.getByTestId('mfa-tab-totp')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('mfa-challenge-input')).toBeInTheDocument();
  });

  it('switches to recovery tab when clicked', async () => {
    render(<MfaChallenge />);
    await userEvent.click(screen.getByTestId('mfa-tab-recovery'));
    expect(screen.getByTestId('mfa-tab-recovery')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('mfa-challenge-recovery-input')).toBeInTheDocument();
  });

  it('submits the TOTP and redirects to /dashboard on success', async () => {
    vi.mocked(api.mfa.verify).mockResolvedValue({ success: true, method: 'TOTP' });

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

    render(<MfaChallenge successHref="/dashboard" />);
    await userEvent.type(screen.getByTestId('mfa-challenge-input'), '123456');
    await userEvent.click(screen.getByTestId('mfa-challenge-submit'));

    await waitFor(() => {
      expect(api.mfa.verify).toHaveBeenCalledWith('123456');
      expect(hrefSpy).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('honors a custom successHref', async () => {
    vi.mocked(api.mfa.verify).mockResolvedValue({ success: true, method: 'TOTP' });
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

    render(<MfaChallenge successHref="/welcome" />);
    await userEvent.type(screen.getByTestId('mfa-challenge-input'), '654321');
    await userEvent.click(screen.getByTestId('mfa-challenge-submit'));

    await waitFor(() => {
      expect(hrefSpy).toHaveBeenCalledWith('/welcome');
    });
  });

  it('shows validation error when code is too short', async () => {
    render(<MfaChallenge />);
    await userEvent.type(screen.getByTestId('mfa-challenge-input'), '12');
    await userEvent.click(screen.getByTestId('mfa-challenge-submit'));
    expect(await screen.findByTestId('mfa-challenge-error')).toHaveTextContent(/6-digit/i);
    expect(api.mfa.verify).not.toHaveBeenCalled();
  });

  it('shows "expired or invalid" message when the API returns 401', async () => {
    vi.mocked(api.mfa.verify).mockRejectedValue(new ApiError(401, 'expired'));
    render(<MfaChallenge />);
    await userEvent.type(screen.getByTestId('mfa-challenge-input'), '123456');
    await userEvent.click(screen.getByTestId('mfa-challenge-submit'));

    expect(await screen.findByTestId('mfa-challenge-error')).toHaveTextContent(
      /expired or invalid/i
    );
    // input is cleared after failure
    expect(screen.getByTestId('mfa-challenge-input')).toHaveValue('');
  });

  it('shows "not accepted" when success:false is returned', async () => {
    vi.mocked(api.mfa.verify).mockResolvedValue({ success: false });
    render(<MfaChallenge />);
    await userEvent.type(screen.getByTestId('mfa-challenge-input'), '123456');
    await userEvent.click(screen.getByTestId('mfa-challenge-submit'));
    expect(await screen.findByTestId('mfa-challenge-error')).toHaveTextContent(/not accepted/i);
  });

  it('recovery tab posts the recovery code and redirects', async () => {
    vi.mocked(api.mfa.verify).mockResolvedValue({ success: true, method: 'RECOVERY_CODE' });
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

    render(<MfaChallenge />);
    await userEvent.click(screen.getByTestId('mfa-tab-recovery'));
    await userEvent.type(
      screen.getByTestId('mfa-challenge-recovery-input'),
      'AAAA-1234'
    );
    await userEvent.click(screen.getByTestId('mfa-challenge-recovery-submit'));

    await waitFor(() => {
      expect(api.mfa.verify).toHaveBeenCalledWith('AAAA-1234');
      expect(hrefSpy).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('invokes onCancel when the cancel button is clicked', async () => {
    const onCancel = vi.fn();
    render(<MfaChallenge onCancel={onCancel} />);
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });
});
