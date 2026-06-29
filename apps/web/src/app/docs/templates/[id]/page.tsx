import { TemplateRenderer } from '@/components/templates/TemplateRenderer';

export const metadata = {
  title: 'Template · Omyxia',
};

interface Params {
  params: { id: string };
}

export default function TemplateDetailPage({ params }: Params) {
  return (
    <main className="mx-auto max-w-4xl p-6">
      <TemplateRenderer templateId={params.id} />
    </main>
  );
}