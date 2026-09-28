/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Every page here is an authenticated, per-user dashboard — Next's default
  // long s-maxage on prerendered pages assumes a CDN that understands its
  // ISR revalidation protocol (Vercel's edge does; Hostinger's generic nginx
  // CDN doesn't), so it was caching HTML/JS-bundle references from whatever
  // build happened to be live when it first cached each route and never
  // re-checking origin — every deploy since went silently invisible. no-store
  // makes every hop (browser, CDN, Hostinger) always fetch fresh from origin.
  // /_next/static/* stays cached forever below: those filenames are
  // content-hashed, so a new build never reuses a stale one under the same
  // name — there's nothing to go stale.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store, must-revalidate' }],
      },
      {
        source: '/_next/static/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ];
  },
};

module.exports = nextConfig;
