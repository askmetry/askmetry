import { config } from 'dotenv';
import path from 'node:path';
import type { NextConfig } from 'next';

// Root-.env laden (DATABASE_URL, BETTER_AUTH_*). Werte werden nie ausgegeben.
config({ path: path.resolve(process.cwd(), '../../.env'), quiet: true });

const nextConfig: NextConfig = {
  transpilePackages: ['@opengeo/db', '@opengeo/core'],
  serverExternalPackages: ['pg'],
  poweredByHeader: false,
  // Alte Routen (vor der Vereinfachung) auf die neue Struktur umleiten; Query-Parameter bleiben erhalten
  async redirects() {
    return [
      { source: '/w/:slug/prompts', destination: '/w/:slug/fragen', permanent: false },
      { source: '/w/:slug/prompts/:id', destination: '/w/:slug/fragen/:id', permanent: false },
      { source: '/w/:slug/luecken', destination: '/w/:slug/fragen?ohne=1', permanent: false },
      { source: '/w/:slug/sources', destination: '/w/:slug/quellen', permanent: false },
    ];
  },
};

export default nextConfig;
