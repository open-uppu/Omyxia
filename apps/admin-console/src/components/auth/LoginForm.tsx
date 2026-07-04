'use client';

import * as React from 'react';
import { useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { loginWithCredentials } from '@/lib/auth';

interface LoginFormProps {
  /** When true, the dev-mode hint is shown (default admin/admin credentials). */
  devMode: boolean;
  /** Optional explicit redirect target after login (overrides ?next=). */
  redirectTo?: string;
}

/**
 * The login form is a client component so the user gets immediate
 * feedback on a failed attempt without a full page reload. Submission
 * POSTs to /api/auth/login which (in dev mode) mints a local JWT; in
 * production it proxies to the backend's /admin/auth/login (P1.3).
 */
export function LoginForm({ devMode, redirectTo }: LoginFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const next =
    redirectTo ||
    (typeof searchParams?.get('next') === 'string' ? searchParams.get('next')! : '/dashboard');

  // If middleware bounced us because of a wrong-role cookie, surface that.
  const forbiddenReason = searchParams?.get('reason') === 'forbidden';

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await loginWithCredentials(email, password);
      if (!result.ok) {
        setError(result.error || 'Login failed');
        return;
      }
      // Use replace so the back-button doesn't loop back to /login.
      router.replace(next);
    });
  }

  return (
    <Card className="w-full max-w-md" data-testid="login-card">
      <CardHeader className="space-y-1">
        <div className="flex items-center justify-between">
          <CardTitle className="text-2xl" data-testid="login-title">
            Omyxia Admin
          </CardTitle>
          {devMode && (
            <Badge variant="warning" data-testid="dev-mode-badge">
              Dev mode
            </Badge>
          )}
        </div>
        <CardDescription>Sign in with your super_admin account.</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit} data-testid="login-form" noValidate>
        <CardContent className="space-y-4">
          {forbiddenReason && (
            <div
              role="alert"
              data-testid="login-forbidden"
              className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            >
              Your account does not have super_admin access. Please contact the platform owner.
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={pending}
              data-testid="login-email"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={pending}
              data-testid="login-password"
            />
          </div>
          {error && (
            <div
              role="alert"
              data-testid="login-error"
              className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </div>
          )}
          {devMode && (
            <div
              data-testid="login-dev-hint"
              className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
            >
              <strong>Dev credentials:</strong> <code>admin@omyxia.app</code> / <code>admin</code>
            </div>
          )}
        </CardContent>
        <CardFooter className="flex flex-col gap-3">
          <Button type="submit" className="w-full" disabled={pending} data-testid="login-submit">
            {pending ? 'Signing in…' : 'Sign in'}
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            Admin access only. By signing in you agree to the{' '}
            <Link href="/legal/terms" className="underline hover:text-foreground">
              terms of service
            </Link>
            .
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}