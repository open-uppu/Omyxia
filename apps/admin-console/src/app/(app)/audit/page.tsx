import type { Metadata } from 'next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { ScrollText } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Audit',
  description: 'Super admin action audit log.',
};

export default function AuditPage() {
  return (
    <div className="space-y-6" data-testid="page-audit">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <ScrollText className="h-5 w-5" aria-hidden />
            Audit
          </h1>
          <p className="text-sm text-muted-foreground">
            Append-only log of every super_admin action.
          </p>
        </div>
        <Badge variant="secondary">P5.2 — WORM storage</Badge>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Audit log</CardTitle>
          <CardDescription>
            The full audit UI lands with P5.2 (WORM storage + SOC2 docs).
            For now, the table is empty — the shell route exists so the
            sidebar navigation works end-to-end.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-dashed py-12 text-center text-sm text-muted-foreground">
            No events recorded yet.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}