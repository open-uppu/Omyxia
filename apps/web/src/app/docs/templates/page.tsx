import { DocumentTemplatesList } from '@/components/templates/DocumentTemplatesList';

export const metadata = {
  title: 'Document Templates · Omyxia',
};

export default function TemplatesPage() {
  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="mb-4 text-2xl font-semibold">Document templates</h1>
      <DocumentTemplatesList />
    </main>
  );
}