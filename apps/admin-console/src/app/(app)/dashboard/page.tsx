import type { Metadata } from 'next';
import { DashboardClient } from './DashboardClient';

export const metadata: Metadata = {
  title: 'Dashboard',
  description: 'Omyxia admin overview.',
};

export default function DashboardPage() {
  return <DashboardClient />;
}
