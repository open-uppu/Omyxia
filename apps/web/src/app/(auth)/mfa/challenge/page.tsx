import { MfaChallenge } from '@/components/auth/MfaChallenge';

export const metadata = {
  title: 'Two-factor verification · Omyxia',
};

export default function MfaChallengePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-10">
      <MfaChallenge />
    </main>
  );
}
