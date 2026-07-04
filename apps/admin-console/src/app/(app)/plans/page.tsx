import type { Metadata } from 'next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Tags } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Plans',
  description: 'Omyxia subscription plans and add-ons.',
};

export default function PlansPage() {
  return (
    <div className="space-y-6" data-testid="page-plans">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Tags className="h-5 w-5" aria-hidden />
            Plans
          </h1>
          <p className="text-sm text-muted-foreground">
            Free / Pro / Enterprise tiers + add-on modules.
          </p>
        </div>
        <Badge variant="secondary">P2.5 — coming next</Badge>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <PlanStub name="Free" price="$0" bullets={['1 user', '1 GB', 'Email only']} />
        <PlanStub name="Pro" price="$99/mo" bullets={['25 users', '100 GB', 'Email + Chat + HR']} highlight />
        <PlanStub
          name="Enterprise"
          price="$499/mo"
          bullets={['Unlimited users', 'Unlimited storage', 'All modules + SSO']}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Plan management</CardTitle>
          <CardDescription>
            Editing plans and add-ons lands in card P2.5. The seed data for
            these three tiers will be created by P1.2.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Read-only preview for now.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function PlanStub({
  name,
  price,
  bullets,
  highlight,
}: {
  name: string;
  price: string;
  bullets: string[];
  highlight?: boolean;
}) {
  return (
    <Card className={highlight ? 'border-primary/40 shadow-sm' : undefined}>
      <CardHeader>
        <CardDescription>{name}</CardDescription>
        <CardTitle className="text-2xl">{price}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1 text-sm text-muted-foreground">
          {bullets.map((b) => (
            <li key={b}>• {b}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}