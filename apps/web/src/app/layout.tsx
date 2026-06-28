import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Omyxia',
  description: 'Multi-tenant Enterprise IT Master Blueprint',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}