/** @type {import('next').NextConfig} */

const isDev = process.env.NODE_ENV !== 'production';

// Content-Security-Policy: locked down to self + Supabase (optional storage
// upgrade — see src/lib/storage.ts) + Chargily Pay (subscription checkout —
// see src/lib/payments/chargily.ts). Add other domains here only if you
// introduce a new third-party integration.
//
// 'unsafe-eval' is added to script-src ONLY in dev mode (`npm run dev`).
// React's development tooling (component stack traces, Fast Refresh) uses
// eval() internally — without this, dev mode throws a console error and
// some of that tooling silently breaks. Production React never calls
// eval() at all, so the real, deployed CSP (`npm run build && npm start`)
// stays fully strict — this is a dev-only relaxation, not a weakened
// production security posture.
const ContentSecurityPolicy = `
  default-src 'self';
  script-src 'self' 'unsafe-inline' ${isDev ? "'unsafe-eval'" : ''} https://pay.chargily.net;
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob: https://*.supabase.co;
  font-src 'self' data:;
  connect-src 'self' https://*.supabase.co https://api.anthropic.com https://vision.googleapis.com https://pay.chargily.net;
  frame-ancestors 'none';
  base-uri 'self';
  form-action 'self';
  object-src 'none';
  upgrade-insecure-requests;
`.replace(/\s{2,}/g, ' ').trim();

const securityHeaders = [
  { key: 'Content-Security-Policy', value: ContentSecurityPolicy },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false, // don't advertise "Next.js" to fingerprinting scanners
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.supabase.co' },
    ],
  },
  experimental: {
    // Defense in depth: this app doesn't use Server Actions, but capping
    // this closes it off explicitly rather than leaving Next's default
    // open. The real request-size guard for photo uploads is the
    // MAX_IMAGE_BASE64_CHARS check in src/app/api/aipet/submissions/route.ts.
    serverActions: { bodySizeLimit: '15mb' },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

module.exports = nextConfig;
