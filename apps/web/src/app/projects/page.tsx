import { ProjectsList } from '@/components/projects/ProjectsList';

export const metadata = {
  title: 'Projects · Omyxia',
};

export default function ProjectsPage() {
  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="mb-4 text-2xl font-semibold">Projects</h1>
      <ProjectsList />
    </main>
  );
}