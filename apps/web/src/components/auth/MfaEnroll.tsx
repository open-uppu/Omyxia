'use client';

/**
 * MFA enrollment wizard — 3 steps.
 *
 * Step 1 — explain benefits + "Start setup" button
 * Step 2 — show QR code (qrcode.react) + secret (copyable) + 10 recovery codes (copyable)
 * Step 3 — 6-digit TOTP verify input. On success → enables MFA via /mfa/verify (confirm-mode)
 *
 * Uses react-hook-form for the TOTP input validation; the page form is simple
 * enough that a single useFieldArray/useForm suffices.
 */

import * as React from 'react';
import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Check, Copy, ShieldCheck, Smartphone, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Input';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

const totpSchema = z.object({
  code: z
    .string()
    .min(6, 'Enter the 6-digit code from your authenticator app.')
    .max(9, 'Codes are at most 9 characters (with hyphen).')
    .regex(/^[0-9-]+$/, 'Numbers only.'),
});
type TotpForm = z.infer<typeof totpSchema>;

type Step = 'intro' | 'qr' | 'verify';

export interface MfaEnrollProps {
  /** Optional already-fetched enrollment (storybook / tests) */
  initial?: Awaited<ReturnType<typeof api.mfa.enroll>>;
  /** Called after MFA has been successfully enabled. */
  onComplete?: () => void;
  /** Custom next step within the app — defaults to /dashboard. */
  completionHref?: string;
}

export function MfaEnroll({ initial, onComplete, completionHref = '/dashboard' }: MfaEnrollProps) {
  const [step, setStep] = useState<Step>('intro');
  const [enrollment, setEnrollment] = useState<Awaited<ReturnType<typeof api.mfa.enroll>> | null>(
    initial ?? null
  );
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<TotpForm>({
    resolver: zodResolver(totpSchema),
    defaultValues: { code: '' },
  });

  async function startSetup() {
    setEnrollError(null);
    try {
      const result = await api.mfa.enroll();
      setEnrollment(result);
      setStep('qr');
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Failed to start MFA setup.';
      setEnrollError(msg);
    }
  }

  async function onVerify(values: TotpForm) {
    if (!enrollment) return;
    setVerifyError(null);
    setCompleting(true);
    try {
      const result = await api.mfa.verify(values.code.trim());
      if (!result.success) {
        setVerifyError('That code was not accepted. Try the latest one in your app.');
        reset({ code: '' });
        return;
      }
      onComplete?.();
      if (typeof window !== 'undefined') {
        window.location.href = completionHref;
      }
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Verification failed. Please try again.';
      setVerifyError(msg);
      reset({ code: '' });
    } finally {
      setCompleting(false);
    }
  }

  // Reset the form whenever we move into verify step
  useEffect(() => {
    if (step === 'verify') reset({ code: '' });
  }, [step, reset]);

  return (
    <div
      className="mx-auto flex w-full max-w-2xl flex-col gap-6 rounded-lg border bg-card p-6 text-card-foreground shadow-sm"
      data-testid="mfa-enroll"
      data-step={step}
    >
      <Stepper step={step} />

      {step === 'intro' && (
        <section data-testid="mfa-enroll-intro" className="flex flex-col gap-4">
          <header className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              <ShieldCheck className="mr-2 inline h-6 w-6 text-primary" />
              Secure your account with two-factor authentication
            </h1>
            <p className="text-sm text-muted-foreground">
              Add a second verification step using an authenticator app on your phone.
              Omyxia will ask for a 6-digit code at sign-in.
            </p>
          </header>

          <ul className="grid gap-3 text-sm">
            <Benefit icon={Smartphone}>Works with Google Authenticator, 1Password, Authy & more.</Benefit>
            <Benefit icon={KeyRound}>You&apos;ll receive 10 one-time recovery codes for emergencies.</Benefit>
            <Benefit icon={ShieldCheck}>Required for OWNER / ADMIN roles in production.</Benefit>
          </ul>

          {enrollError && (
            <p role="alert" className="text-sm text-destructive">
              {enrollError}
            </p>
          )}

          <div className="flex justify-end">
            <Button data-testid="mfa-enroll-start" onClick={startSetup}>
              Start setup
            </Button>
          </div>
        </section>
      )}

      {step === 'qr' && enrollment && (
        <section data-testid="mfa-enroll-qr" className="flex flex-col gap-6">
          <header>
            <h2 className="text-xl font-semibold tracking-tight">Scan this QR code</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Open your authenticator app and scan this image. The app will start showing 6-digit codes.
            </p>
          </header>

          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            <div
              data-testid="mfa-qr"
              className="rounded-md border bg-white p-3"
              aria-label="MFA QR code"
            >
              <QRCodeSVG value={enrollment.otpauthUrl} size={192} />
            </div>

            <div className="flex flex-1 flex-col gap-3 text-sm">
              <SecretBlock secret={enrollment.secret} />
              <RecoveryCodesList codes={enrollment.recoveryCodes} />
            </div>
          </div>

          <div className="flex justify-between">
            <Button
              variant="ghost"
              data-testid="mfa-enroll-back-1"
              onClick={() => setStep('intro')}
            >
              Back
            </Button>
            <Button data-testid="mfa-enroll-to-verify" onClick={() => setStep('verify')}>
              I&apos;ve scanned it — continue
            </Button>
          </div>
        </section>
      )}

      {step === 'verify' && (
        <section data-testid="mfa-enroll-verify" className="flex flex-col gap-4">
          <header>
            <h2 className="text-xl font-semibold tracking-tight">Verify your authenticator</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Enter the 6-digit code your app is currently showing.
            </p>
          </header>

          <form
            onSubmit={handleSubmit(onVerify)}
            className="flex flex-col gap-3"
            noValidate
          >
            <div className="flex flex-col gap-1">
              <Label htmlFor="mfa-code">6-digit code</Label>
              <Input
                id="mfa-code"
                autoComplete="one-time-code"
                inputMode="numeric"
                pattern="[0-9-]*"
                maxLength={9}
                aria-invalid={Boolean(errors.code) || undefined}
                data-testid="mfa-code-input"
                {...register('code')}
              />
              {errors.code && (
                <p className="text-xs text-destructive" data-testid="mfa-code-error">
                  {errors.code.message}
                </p>
              )}
            </div>

            {verifyError && (
              <p role="alert" className="text-sm text-destructive" data-testid="mfa-verify-error">
                {verifyError}
              </p>
            )}

            <div className="flex justify-between pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setStep('qr')}
                data-testid="mfa-enroll-back-2"
              >
                Back
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting || completing}
                data-testid="mfa-enroll-submit"
              >
                {completing ? 'Enabling…' : 'Enable MFA'}
              </Button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}

function Stepper({ step }: { step: Step }) {
  const items: { id: Step; label: string }[] = [
    { id: 'intro', label: 'Intro' },
    { id: 'qr', label: 'Scan' },
    { id: 'verify', label: 'Verify' },
  ];
  const activeIdx = items.findIndex((i) => i.id === step);
  return (
    <ol
      aria-label="MFA enrollment progress"
      className="flex items-center gap-2 text-xs text-muted-foreground"
      data-testid="mfa-stepper"
    >
      {items.map((it, idx) => {
        const active = idx === activeIdx;
        const done = idx < activeIdx;
        return (
          <li key={it.id} className="flex items-center gap-2">
            <span
              className={cn(
                'inline-flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-semibold',
                done && 'border-primary bg-primary text-primary-foreground',
                active && 'border-primary text-primary',
                !active && !done && 'border-border text-muted-foreground'
              )}
            >
              {done ? <Check className="h-3.5 w-3.5" /> : idx + 1}
            </span>
            <span className={cn(active && 'text-foreground')}>{it.label}</span>
            {idx < items.length - 1 && <span className="mx-1 h-px w-8 bg-border" />}
          </li>
        );
      })}
    </ol>
  );
}

function Benefit({
  icon: Icon,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-3">
      <Icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
      <span>{children}</span>
    </li>
  );
}

function SecretBlock({ secret }: { secret: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-1" data-testid="mfa-secret">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Manual entry secret
      </span>
      <div className="flex items-center gap-2">
        <code className="flex-1 select-all break-all rounded bg-muted px-2 py-1 font-mono text-xs">
          {secret}
        </code>
        <Button
          size="icon"
          variant="ghost"
          type="button"
          aria-label="Copy secret"
          data-testid="mfa-secret-copy"
          onClick={() => {
            if (typeof navigator !== 'undefined' && navigator.clipboard) {
              navigator.clipboard.writeText(secret).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }).catch(() => setCopied(false));
            }
          }}
        >
          {copied ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

function RecoveryCodesList({ codes }: { codes: string[] }) {
  const [copied, setCopied] = useState(false);
  const formatted = codes.join('\n');

  return (
    <div className="flex flex-col gap-1" data-testid="mfa-recovery-codes">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Recovery codes
        </span>
        <Button
          size="sm"
          variant="ghost"
          type="button"
          onClick={() => {
            if (typeof navigator !== 'undefined' && navigator.clipboard) {
              navigator.clipboard.writeText(formatted).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }).catch(() => setCopied(false));
            }
          }}
          data-testid="mfa-recovery-copy"
        >
          <Copy className="mr-1 h-3.5 w-3.5" />
          {copied ? 'Copied' : 'Copy all'}
        </Button>
      </div>
      <ul className="grid grid-cols-2 gap-1 rounded-md border bg-muted/50 p-3 font-mono text-xs sm:grid-cols-2">
        {codes.map((c, i) => (
          <li key={`${c}-${i}`} data-testid={`mfa-recovery-${i}`} className="select-all">
            {c}
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-muted-foreground">
        Save these somewhere safe. Each code can be used once if you lose your device.
      </p>
    </div>
  );
}

export default MfaEnroll;
