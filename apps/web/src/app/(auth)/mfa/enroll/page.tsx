import { MfaEnroll } from '@/components/auth/MfaEnroll';

export const metadata = {
  title: 'Enable two-factor authentication · Omyxia',
  description: 'Set up TOTP-based two-factor authentication for your Omyxia account.',
};

export default function MfaEnrollPage() {
  return (
    <main className="min-h-screen bg-muted/30 px-4 py-10">
      <MfaEnroll />
    </main>
  );
}
