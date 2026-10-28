import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // sharp and the Prisma driver adapter run only on the server (Node.js runtime).
  serverExternalPackages: ['sharp', '@prisma/adapter-pg', 'pg', 'nodemailer', 'bcryptjs'],
  experimental: {
    // Photos travel to Vercel Blob directly; Server Actions only carry small JSON.
    serverActions: { bodySizeLimit: '1mb' },
  },
  async headers() {
    return [
      {
        // The service worker must always be fresh and may control the whole site.
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
        ],
      },
      {
        source: '/api/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
