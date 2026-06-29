'use client';

/**
 * MFA challenge screen — fired when an authenticated session requires
 * step-up verification (e.g. after login, before granting access).
 *
 * Two paths:
 *   - Primary: 6-digit TOTP from the authenticator app
 *   - Fallback: paste a recovery code
 */

import * as React from 'react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { KeyRound, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Input';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

const totpSchema = z.object({
  code: z.string().min(6, 'Enter your 6-digit code.').max(9),
});
const recoverySchema = z.object({
  code: z.string().min(8, 'Paste a recovery code (e.g. AAAA-1234).'),
});
type TotpForm = z.infer<typeof totpSchema>;
type RecoveryForm = z.infer<typeof recoverySchema>;

export interface MfaChallengeProps {
  /** Where to redirect after successful verification. */
  successHref?: string;
  /** Maximum length of a single 6-digit input box for paste UX. */
  onCancel?: () => void;
}

type Mode = 'totp' | 'recovery';

export function MfaChallenge({ successHref = '/dashboard', onCancel }: MfaChallengeProps) {
  const [mode, setMode] = useState<Mode>('totp');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const totp = useForm<TotpForm>({
    resolver: zodResolver(totpSchema),
    defaultValues: { code: '' },
  });
  const recovery = useForm<RecoveryForm>({
    resolver: zodResolver(recoverySchema),
    defaultValues: { code: '' },
  });

  async function submit(value: string, isRecovery: boolean) {
    setError(null);
    setSubmitting(true);
    try {
      const result = await api.mfa.verify(value.trim());
      if (!result.success) {
        setError('That code was not accepted. Try a fresh one.');
        return;
      }
      if (typeof window !== 'undefined') {
        window.location.href = successHref;
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setError('Code expired or invalid. Generate a new code and try again.');
      } else {
        const msg =
          e instanceof Error ? e.message : 'Verification failed. Try again.';
        setError(msg);
      }
      if (isRecovery) recovery.reset({ code: '' });
      else totp.reset({ code: '' });
    } finally {
      setSubmitting(false);
    }
  }

  async function onTotp(values: TotpForm) {
    await submit(values.code, false);
  }
  async function onRecovery(values: RecoveryForm) {
    await submit(values.code, true);
  }

  return (
    <div
      className="mx-auto flex w-full max-w-md flex-col gap-6 rounded-lg border bg-card p-6 text-card-foreground shadow-sm"
      data-testid="mfa-challenge"
      data-mode={mode}
    >
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Two-factor verification</h1>
        <p className="text-sm text-muted-foreground">
          Enter the code from your authenticator app to continue.
        </p>
      </header>

      {/* Mode tabs */}
      <div
        role="tablist"
        aria-label="Verification method"
        className="inline-flex items-center rounded-md border bg-muted p-1 text-xs"
      >
        <TabBtn
          active={mode === 'totp'}
          onClick={() => setMode('totp')}
          icon={Smartphone}
          testId="mfa-tab-totp"
        >
          Authenticator code
        </TabBtn>
        <TabBtn
          active={mode === 'recovery'}
          onClick={() => setMode('recovery')}
          icon={KeyRound}
          testId="mfa-tab-recovery"
        >
          Recovery code
        </TabBtn>
      </div>

      {mode === 'totp' ? (
        <form
          noValidate
          onSubmit={totp.handleSubmit(onTotp)}
          data-testid="mfa-challenge-totp-form"
          className="flex flex-col gap-3"
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="mfa-challenge-code">6-digit code</Label>
            <Input
              id="mfa-challenge-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={9}
              data-testid="mfa-challenge-input"
              {...totp.register('code')}
              aria-invalid={Boolean(totp.formState.errors.code) || undefined}
            />
            {totp.formState.errors.code && (
              <p className="text-xs text-destructive" data-testid="mfa-challenge-error">
                {totp.formState.errors.code.message}
              </p>
            )}
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive" data-testid="mfa-challenge-error">
              {error}
            </p>
          )}
          <div className="flex justify-between gap-2 pt-2">
            {onCancel && (
              <Button type="button" variant="ghost" onClick={onCancel}>
                Cancel
              </Button>
            )}
            <Button
              type="submit"
              disabled={submitting}
              data-testid="mfa-challenge-submit"
              className="ml-auto"
            >
              {submitting ? 'Verifying…' : 'Verify'}
            </Button>
          </div>
        </form>
      ) : (
        <form
          noValidate
          onSubmit={recovery.handleSubmit(onRecovery)}
          data-testid="mfa-challenge-recovery-form"
          className="flex flex-col gap-3"
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="mfa-challenge-recovery">Recovery code</Label>
            <Input
              id="mfa-challenge-recovery"
              autoComplete="off"
              placeholder="e.g. ABCD-1234"
              data-testid="mfa-challenge-recovery-input"
              {...recovery.register('code')}
              aria-invalid={Boolean(recovery.formState.errors.code) || undefined}
            />
            {recovery.formState.errors.code && (
              <p className="text-xs text-destructive" data-testid="mfa-challenge-recovery-error">
                {recovery.formState.errors.code.message}
              </p>
            )}
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive" data-testid="mfa-challenge-error">
              {error}
            </p>
          )}
          <div className="flex justify-end pt-2">
            <Button
              type="submit"
              disabled={submitting}
              data-testid="mfa-challenge-recovery-submit"
            >
              {submitting ? 'Verifying…' : 'Use code'}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  icon: Icon,
  children,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-testid={testId}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 transition-colors',
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground'
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {children}
    </button>
  );
}

export default MfaChallenge;
