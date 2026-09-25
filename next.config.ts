import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  devIndicators: false,
  // Next 16.3 auto-generates AGENTS.md/CLAUDE.md on dev/build; opt out so the
  // version bump introduces no new repo files (see generate-agent-files.js).
  agentRules: false,
  experimental: {
    // Default 1MB is below our own 2MB school-logo upload limit (uploadSchoolLogo,
    // school/actions.ts) — raised to fit that plus multipart/base64 overhead.
    serverActions: {
      bodySizeLimit: '3mb',
    },
  },
  // Legacy URL redirects from the pre-Modernist route names to the 7-workspace
  // sidebar's URLs (src/lib/nav/navConfig.ts). Temporary (permanent: false) so
  // these can be flipped to permanent once the new URLs are proven out.
  async redirects() {
    return [
      { source: '/dashboard', destination: '/today', permanent: false },
      { source: '/activity', destination: '/today/record', permanent: false },
      { source: '/today/activity', destination: '/today/record', permanent: false },
      { source: '/invoices', destination: '/money/invoices', permanent: false },
      { source: '/invoices/:path*', destination: '/money/invoices/:path*', permanent: false },
      { source: '/payments', destination: '/money/collections', permanent: false },
      { source: '/reports', destination: '/money/reports', permanent: false },
      { source: '/reports/:path*', destination: '/money/reports/:path*', permanent: false },
      { source: '/settings/data-privacy/:path*', destination: '/team/data-privacy/:path*', permanent: false },
      { source: '/settings/academic-structure', destination: '/school/academic-structure', permanent: false },
      { source: '/settings/payments', destination: '/school/payments', permanent: false },
      { source: '/settings/reminders', destination: '/school/reminders', permanent: false },
      { source: '/settings/discounts', destination: '/school/discounts', permanent: false },
      { source: '/settings/roles-permissions', destination: '/team/roles-permissions', permanent: false },
      { source: '/settings/audit-log', destination: '/team/audit-log', permanent: false },
      { source: '/settings/account-security', destination: '/team/account-security', permanent: false },
      { source: '/settings/users', destination: '/team/users', permanent: false },
      { source: '/settings', destination: '/school', permanent: false },
    ]
  },
};

export default nextConfig;
