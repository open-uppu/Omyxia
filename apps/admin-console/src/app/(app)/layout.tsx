import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { AdminShell } from '@/components/layout/AdminShell';
import { verifyAdminToken } from '@/lib/jwt';
import type { UserMenuUser } from '@/components/layout/UserMenu';

/**
 * Server-side auth gate for the (app) route group.
 *
 * The middleware already redirects unauthenticated requests to /login,
 * but we re-verify here as a defence in depth — middleware bugs MUST
 * NOT leak authenticated routes. If the cookie is missing or invalid
 * here we send the user to /login (the same path the middleware uses).
 *
 * On success we render <AdminShell> with the verified user. The user
 * object is passed only to the client component that needs it (UserMenu);
 * server components further down never see it.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = cookies();
  const token = cookieStore.get('admin_session')?.value;

  if (!token) {
    redirect('/login');
  }

  const verified = await verifyAdminToken(token);
  if (!verified.ok) {
    redirect('/login');
  }

  const user: UserMenuUser = {
    id: verified.claims.sub,
    email: verified.claims.email,
    name: verified.claims.name,
    role: verified.claims.role,
  };

  return <AdminShell user={user}>{children}</AdminShell>;
}