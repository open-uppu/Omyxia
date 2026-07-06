import type { Metadata } from 'next';
import { FeatureGuard } from '@/components/entitlements';
import { PlansClient } from '@/components/plans/PlansClient';

export const metadata: Metadata = {
  title: 'Plans',
  description: 'Omyxia subscription plans and add-ons.',
};

export default function PlansPage() {
  // P3.2 gates the Plans editor behind `admin.plans` (PRO+).
  // P2.5 ships the actual CRUD UI inside <PlansClient />.
  return (
    <FeatureGuard
      feature="admin.plans"
      featureLabel="Plans"
      fallback={
        <div
          className="rounded-md border border-dashed py-12 text-center text-sm text-muted-foreground"
          data-testid="page-plans-pending"
        >
          Checking your access…
        </div>
      }
    >
      <PlansClient />
    </FeatureGuard>
  );
}
