const { PHASE_DEVELOPMENT_SERVER } = require('next/constants');

/** @type {(phase: string) => import('next').NextConfig} */
module.exports = phase => {
  const isDev = phase === PHASE_DEVELOPMENT_SERVER;

  return {
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
    //
    // ...but only in a production build. The dev server reuses the same file
    // names while their contents change (a new .env.local value, an edited
    // page), so a year-long "immutable" cache there left browsers running old
    // compiled code — including an old Supabase key baked in at compile time,
    // which showed up as "Invalid API key" on the sign-in page.
    async headers() {
      const rules = [
        {
          source: '/:path*',
          headers: [{ key: 'Cache-Control', value: 'no-store, must-revalidate' }],
        },
      ];
      if (!isDev) {
        rules.push({
          source: '/_next/static/:path*',
          headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
        });
      }
      return rules;
    },
  };
};
