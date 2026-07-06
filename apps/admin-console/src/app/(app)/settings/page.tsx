import type { Metadata } from 'next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Settings as SettingsIcon } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Settings',
  description: 'Omyxia admin console settings.',
};

export default function SettingsPage() {
  return (
    <div className="space-y-6" data-testid="page-settings">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <SettingsIcon className="h-5 w-5" aria-hidden />
            Settings
          </h1>
          <p className="text-sm text-muted-foreground">
            Console-level configuration and admin profile.
          </p>
        </div>
        <Badge variant="secondary">placeholder</Badge>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Coming soon</CardTitle>
          <CardDescription>
            Profile, password, MFA, session timeout, and notification
            preferences will live here. The shell route exists so the
            sidebar is fully navigable in v2.0.0 P2.1.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Admin profile (name, email)</li>
            <li>Password change + MFA enrollment</li>
            <li>Session timeout policy</li>
            <li>Webhook delivery for audit events</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}