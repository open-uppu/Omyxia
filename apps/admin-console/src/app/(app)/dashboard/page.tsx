import type { Metadata } from 'next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { LayoutDashboard } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Dashboard',
  description: 'Omyxia admin overview.',
};

export default function DashboardPage() {
  return (
    <div className="space-y-6" data-testid="page-dashboard">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <LayoutDashboard className="h-5 w-5" aria-hidden />
            Dashboard
          </h1>
          <p className="text-sm text-muted-foreground">
            High-level overview of tenants, plans, and platform health.
          </p>
        </div>
        <Badge variant="secondary">P2.2 — coming next</Badge>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <PlaceholderStat label="Tenants" testId="stat-tenants" />
        <PlaceholderStat label="MRR" testId="stat-mrr" />
        <PlaceholderStat label="Storage" testId="stat-storage" />
        <PlaceholderStat label="API volume (24h)" testId="stat-api" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Welcome to the Omyxia Admin Console</CardTitle>
          <CardDescription>
            This is the v2.0.0 admin shell. Use the sidebar to navigate to
            Tenants, Plans, Audit, and Settings. The Dashboard metrics will
            land in card P2.2.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            The shell enforces <strong>super_admin</strong> access via a
            signed JWT cookie. Non-admin sessions are bounced to{' '}
            <code>/login</code>.
          </p>
          <p>
            See <code>apps/admin-console/README.md</code> for local dev
            instructions.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function PlaceholderStat({ label, testId }: { label: string; testId: string }) {
  return (
    <Card data-testid={testId}>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl text-muted-foreground/60">—</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">awaiting P2.2</p>
      </CardContent>
    </Card>
  );
}