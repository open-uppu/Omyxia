import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginForm } from '@/components/auth/LoginForm';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to the Omyxia admin console.',
};

export const dynamic = 'force-dynamic'; // never cache the login page

export default function LoginPage() {
  const devMode = process.env.ADMIN_DEV_MODE === 'true';

  return (
    <main
      data-testid="login-page"
      className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-background via-background to-muted px-4 py-12"
    >
      <div className="mb-8 flex items-center gap-3">
        <span
          aria-hidden
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-lg font-bold text-primary-foreground"
        >
          O
        </span>
        <div>
          <div className="text-lg font-semibold tracking-tight">Omyxia Admin</div>
          <div className="text-xs text-muted-foreground">admin.omyxia.app</div>
        </div>
      </div>
      <Suspense fallback={<div data-testid="login-loading">Loading…</div>}>
        <LoginForm devMode={devMode} />
      </Suspense>
    </main>
  );
}