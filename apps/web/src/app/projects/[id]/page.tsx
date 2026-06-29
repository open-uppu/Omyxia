import { ProjectDetail } from '@/components/projects/ProjectDetail';

export const metadata = {
  title: 'Project · Omyxia',
};

interface Params {
  params: { id: string };
}

export default function ProjectDetailPage({ params }: Params) {
  return (
    <main className="mx-auto max-w-4xl p-6">
      <ProjectDetail projectId={params.id} />
    </main>
  );
}