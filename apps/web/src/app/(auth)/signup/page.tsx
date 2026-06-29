import { SignupWizard } from '@/components/auth/SignupWizard';

export const metadata = {
  title: 'Create your workspace · Omyxia',
  description: 'Set up a new Omyxia workspace in three quick steps.',
};

export default function SignupPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-10">
      <SignupWizard />
    </main>
  );
}
