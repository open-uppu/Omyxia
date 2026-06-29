'use client';

/**
 * Signup / onboarding wizard.
 *
 * Step 1: workspace (account basics)
 *   - email, password, full name, tenant name, locale
 * Step 2: invite team (optional)
 *   - tags of email addresses + role
 * Step 3: done
 *   - summary + "Continue to dashboard" CTA
 *
 * Step 1 calls POST /api/auth/signup.
 * Step 2 calls POST /api/invites with the chosen emails.
 */

import * as React from 'react';
import { useState } from 'react';
import { useForm, useFieldArray, type SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Building2, Mail, Plus, Sparkles, Trash2, Users, Check } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Input';
import { api, ApiError, type AuthSession } from '@/lib/api';
import { cn } from '@/lib/utils';

const workspaceSchema = z.object({
  email: z.string().email('Enter a valid email.'),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
  name: z.string().min(1, 'Your name is required.'),
  tenantName: z.string().min(1, 'Workspace (tenant) name is required.'),
  locale: z.enum(['th', 'en']).default('en'),
});
type WorkspaceForm = z.infer<typeof workspaceSchema>;

const inviteSchema = z.object({
  invites: z
    .array(
      z.object({
        email: z.string().email('Enter a valid email.'),
      })
    )
    .default([]),
  skip: z.boolean().default(false),
});
type InviteForm = z.infer<typeof inviteSchema>;

type Step = 'workspace' | 'invite' | 'done';

const LOCALES: Array<{ value: 'th' | 'en'; label: string }> = [
  { value: 'en', label: 'English' },
  { value: 'th', label: 'ไทย (Thai)' },
];

interface SignupWizardProps {
  /** Where to send the user when they finish the wizard. */
  dashboardHref?: string;
  /** Force the initial step (used in tests). */
  initialStep?: Step;
}

export function SignupWizard({ dashboardHref = '/dashboard', initialStep = 'workspace' }: SignupWizardProps) {
  const [step, setStep] = useState<Step>(initialStep);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [inviteStatus, setInviteStatus] = useState<string | null>(null);

  const workspace = useForm<WorkspaceForm>({
    resolver: zodResolver(workspaceSchema),
    defaultValues: { email: '', password: '', name: '', tenantName: '', locale: 'en' },
  });

  const invite = useForm<InviteForm>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { invites: [], skip: false },
  });
  const { fields, append, remove } = useFieldArray({
    control: invite.control,
    name: 'invites',
  });

  const onWorkspaceSubmit: SubmitHandler<WorkspaceForm> = async (values) => {
    setSubmitError(null);
    try {
      const s = await api.auth.signup(values);
      setSession(s);
      setStep('invite');
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Sign up failed. Please try again.';
      setSubmitError(msg);
    }
  };

  const onInviteSubmit: SubmitHandler<InviteForm> = async (values) => {
    setInviteStatus(null);
    setSubmitError(null);
    if (values.skip || values.invites.length === 0) {
      setStep('done');
      return;
    }
    try {
      const emails = values.invites.map((i) => i.email);
      const result = await api.invites.send({ emails });
      setInviteStatus(`Sent ${result.sent} invitation${result.sent === 1 ? '' : 's'}.`);
      setStep('done');
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Invitations failed. You can retry from Settings.';
      setSubmitError(msg);
    }
  };

  return (
    <div
      className="mx-auto flex w-full max-w-xl flex-col gap-6 rounded-lg border bg-card p-6 text-card-foreground shadow-sm"
      data-testid="signup-wizard"
      data-step={step}
    >
      <Stepper currentStep={step} />

      {step === 'workspace' && (
        <section data-testid="signup-step-workspace" className="flex flex-col gap-4">
          <header className="flex items-center gap-3">
            <Building2 className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight">Create your workspace</h1>
          </header>

          <form
            noValidate
            onSubmit={workspace.handleSubmit(onWorkspaceSubmit)}
            className="flex flex-col gap-4"
            data-testid="signup-form"
          >
            <Field label="Your name" error={workspace.formState.errors.name?.message}>
              <Input
                autoComplete="name"
                data-testid="signup-input-name"
                {...workspace.register('name')}
                invalid={Boolean(workspace.formState.errors.name)}
              />
            </Field>
            <Field label="Work email" error={workspace.formState.errors.email?.message}>
              <Input
                type="email"
                autoComplete="email"
                data-testid="signup-input-email"
                {...workspace.register('email')}
                invalid={Boolean(workspace.formState.errors.email)}
              />
            </Field>
            <Field
              label="Password"
              hint="At least 8 characters."
              error={workspace.formState.errors.password?.message}
            >
              <Input
                type="password"
                autoComplete="new-password"
                data-testid="signup-input-password"
                {...workspace.register('password')}
                invalid={Boolean(workspace.formState.errors.password)}
              />
            </Field>
            <Field
              label="Workspace name"
              hint="You can change this later in Settings."
              error={workspace.formState.errors.tenantName?.message}
            >
              <Input
                data-testid="signup-input-tenant"
                {...workspace.register('tenantName')}
                invalid={Boolean(workspace.formState.errors.tenantName)}
              />
            </Field>
            <Field label="Language" error={workspace.formState.errors.locale?.message}>
              <select
                data-testid="signup-input-locale"
                {...workspace.register('locale')}
                className={cn(
                  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
                  'ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
                )}
              >
                {LOCALES.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
            </Field>

            {submitError && (
              <p role="alert" className="text-sm text-destructive" data-testid="signup-error">
                {submitError}
              </p>
            )}

            <div className="flex justify-end pt-2">
              <Button
                type="submit"
                disabled={workspace.formState.isSubmitting}
                data-testid="signup-submit"
              >
                {workspace.formState.isSubmitting ? 'Creating…' : 'Create workspace'}
              </Button>
            </div>
          </form>
        </section>
      )}

      {step === 'invite' && (
        <section data-testid="signup-step-invite" className="flex flex-col gap-4">
          <header className="flex items-center gap-3">
            <Users className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight">Invite your team</h1>
          </header>
          <p className="text-sm text-muted-foreground">
            Optional — you can always invite people later from Settings.
          </p>

          <form
            noValidate
            onSubmit={invite.handleSubmit(onInviteSubmit)}
            className="flex flex-col gap-3"
            data-testid="invite-form"
          >
            <ul className="flex flex-col gap-2" data-testid="invite-list">
              {fields.map((field, idx) => (
                <li
                  key={field.id}
                  className="flex items-start gap-2"
                  data-testid={`invite-row-${idx}`}
                >
                  <div className="flex-1">
                    <Input
                      type="email"
                      placeholder="teammate@example.com"
                      data-testid={`invite-input-${idx}`}
                      {...invite.register(`invites.${idx}.email` as const)}
                      invalid={Boolean(invite.formState.errors.invites?.[idx]?.email)}
                    />
                    {invite.formState.errors.invites?.[idx]?.email && (
                      <p className="mt-1 text-xs text-destructive">
                        {invite.formState.errors.invites[idx]?.email?.message}
                      </p>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove invite ${idx + 1}`}
                    data-testid={`invite-remove-${idx}`}
                    onClick={() => remove(idx)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>

            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="invite-add"
                onClick={() => append({ email: '' })}
              >
                <Plus className="mr-2 h-4 w-4" /> Add another
              </Button>
            </div>

            {submitError && (
              <p role="alert" className="text-sm text-destructive" data-testid="invite-error">
                {submitError}
              </p>
            )}

            <div className="flex justify-between pt-2">
              <Button
                type="submit"
                variant="ghost"
                name="skip"
                onClick={() => invite.setValue('skip', true)}
                data-testid="invite-skip"
              >
                Skip for now
              </Button>
              <Button
                type="submit"
                disabled={invite.formState.isSubmitting}
                data-testid="invite-submit"
                onClick={() => invite.setValue('skip', false)}
              >
                {invite.formState.isSubmitting ? 'Sending…' : 'Send invites'}
              </Button>
            </div>
          </form>
        </section>
      )}

      {step === 'done' && (
        <section data-testid="signup-step-done" className="flex flex-col items-center gap-4 text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Check className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">You&rsquo;re all set</h1>
          {session && (
            <p className="text-sm text-muted-foreground" data-testid="signup-welcome-tenant">
              Welcome to <span className="font-medium text-foreground">{session.tenant.name}</span>.
            </p>
          )}
          {inviteStatus && (
            <p className="text-xs text-muted-foreground" data-testid="signup-invite-status">
              {inviteStatus}
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            We strongly recommend enabling two-factor authentication.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button
              variant="outline"
              data-testid="signup-go-mfa"
              onClick={() => {
                if (typeof window !== 'undefined') window.location.href = '/mfa/enroll';
              }}
            >
              <Sparkles className="mr-2 h-4 w-4" /> Enable MFA
            </Button>
            <Button
              data-testid="signup-go-dashboard"
              onClick={() => {
                if (typeof window !== 'undefined') window.location.href = dashboardHref;
              }}
            >
              Go to dashboard
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label>{label}</Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && (
        <p className="text-xs text-destructive" data-testid="signup-field-error">
          {error}
        </p>
      )}
    </div>
  );
}

function Stepper({ currentStep }: { currentStep: Step }) {
  const items: { id: Step; label: string }[] = [
    { id: 'workspace', label: 'Workspace' },
    { id: 'invite', label: 'Invite' },
    { id: 'done', label: 'Done' },
  ];
  const activeIdx = items.findIndex((i) => i.id === currentStep);
  return (
    <ol
      aria-label="Signup progress"
      className="flex items-center gap-2 text-xs text-muted-foreground"
      data-testid="signup-stepper"
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

export default SignupWizard;
