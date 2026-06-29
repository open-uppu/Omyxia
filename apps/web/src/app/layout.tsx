import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: 'Omyxia',
  description: 'Multi-tenant Enterprise IT Master Blueprint',
  applicationName: 'Omyxia',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Omyxia',
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0a' },
  ],
  viewportFit: 'cover',
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