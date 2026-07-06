/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Standalone admin app — no API proxy to apps/api in v0.1.0.
  // The admin console talks directly to the public admin endpoints (e.g.
  // https://api.omyxia.app/admin/*). P1.3 will define /api/admin/auth/login
  // and /api/admin/me. For now the auth flow runs entirely on the frontend
  // using a dev-only JWT issuer so the shell can be exercised end-to-end.
  async rewrites() {
    const apiUrl = process.env.ADMIN_API_URL;
    if (!apiUrl) return [];
    return [
      { source: '/api/admin/:path*', destination: `${apiUrl}/admin/:path*` },
    ];
  },
  // We are deliberately a separate origin (admin.omyxia.app) and don't
  // ship tenant cookies. auth() lives in its own JWT.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;