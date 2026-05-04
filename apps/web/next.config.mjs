/** @type {import('next').NextConfig} */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@afiliado-master/types'],
  /** Monorepo (Vercel Root Directory = apps/web): inclui pacotes em ../../packages no bundle. */
  outputFileTracingRoot: path.join(__dirname, '../..'),
  experimental: {
    typedRoutes: false,
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
      { protocol: 'http', hostname: '**' },
    ],
  },
};

export default nextConfig;
