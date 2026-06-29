import { AuditLogTable } from '@/components/audit/AuditLogTable';

export const metadata = {
  title: 'Audit Log · Omyxia',
};

export default function AuditPage() {
  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="mb-4 text-2xl font-semibold">Audit Log</h1>
      <AuditLogTable />
    </main>
  );
}
