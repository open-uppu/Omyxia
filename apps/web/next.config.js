/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // API proxy for the Omyxia backend
  async rewrites() {
    const apiUrl = process.env.API_URL || 'http://localhost:3001';
    return [
      { source: '/api/:path*', destination: `${apiUrl}/:path*` },
    ];
  },
};

module.exports = nextConfig;