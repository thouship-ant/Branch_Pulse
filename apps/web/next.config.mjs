import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCAL_HOSTNAMES = ['localhost', '127.0.0.1', '::1'];
const PRODUCTION_API_URL = process.env.API_URL || 'https://api-branchpulse.antstockpulse.pro';
const LOCAL_API_URL = 'http://localhost:4000';

export function getApiBaseUrl() {
  if (typeof window === 'undefined') {
    return PRODUCTION_API_URL;
  }

  return LOCAL_HOSTNAMES.includes(window.location.hostname)
    ? LOCAL_API_URL
    : PRODUCTION_API_URL;
}
const API = getApiBaseUrl();
const here = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Lets a second build (e.g. for browser verification) live beside a running dev server without clobbering it.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  // The Docker image builds a self-contained server (NEXT_STANDALONE=1). Plain `next build` is unchanged.
  ...(process.env.NEXT_STANDALONE === '1'
    ? { output: 'standalone', outputFileTracingRoot: path.join(here, '../../') }
    : {}),
  reactStrictMode: true,
  poweredByHeader: false,
  // The app has its own fixed header/bottom-nav in every corner of the screen; the dev route
  // indicator badge would otherwise sit on top of them (e.g. the phone bottom nav's first tab).
  devIndicators: false,
  // Same-origin API: the browser only ever talks to the web origin, so the SameSite=Strict
  // refresh cookie works and no CORS is needed.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
