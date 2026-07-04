import type { Metadata } from 'next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Building2 } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Tenants',
  description: 'Omyxia tenants — list, search, suspend, impersonate.',
};

export default function TenantsPage() {
  return (
    <div className="space-y-6" data-testid="page-tenants">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Building2 className="h-5 w-5" aria-hidden />
            Tenants
          </h1>
          <p className="text-sm text-muted-foreground">
            Every organisation on the platform.
          </p>
        </div>
        <Badge variant="secondary">P2.3 — coming next</Badge>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Tenant list</CardTitle>
          <CardDescription>
            The list, search, filter, and pagination UI lands in card P2.3,
            depending on the{' '}
            <code>GET /api/admin/tenants</code> endpoint from P1.4.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-dashed py-12 text-center text-sm text-muted-foreground">
            No tenants to show yet — the shell is ready, the data layer is
            next.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}