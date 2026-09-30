import type { Metadata } from "next";

/**
 * Single source of truth for site identity used across layout.tsx,
 * sitemap.ts, robots.ts and every page's metadata — see AGENTS.md's
 * warning to read the local Next.js docs before touching metadata files;
 * this keeps the URL/name in one place instead of re-hardcoding it.
 */
export const SITE_URL = "https://www.fees101.com";
export const SITE_NAME = "Fees101";
export const SUPPORT_EMAIL = "support@fees101.com";

/** Open Graph fields every page shares unless it has a reason not to. */
export const OG_DEFAULTS = {
  siteName: SITE_NAME,
  locale: "en_NG",
  type: "website" as const,
};

/**
 * Builds a consistent per-page Metadata object (title, description,
 * canonical, Open Graph, Twitter card) from a short title + description.
 *
 * Note: per Next.js's metadata merging rules, a child route that sets its
 * own `openGraph`/`twitter` object replaces the parent's wholesale rather
 * than merging field-by-field — so every page built with this helper
 * re-states the shared OG_DEFAULTS rather than relying on inheritance from
 * the root layout.
 */
export function buildPageMetadata({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  /** Route path starting with "/", e.g. "/pricing". Use "/" for the home page. */
  path: string;
}): Metadata {
  const fullTitle = `${title} — ${SITE_NAME}`;
  const url = `${SITE_URL}${path === "/" ? "" : path}`;

  return {
    title,
    description,
    alternates: {
      canonical: path,
    },
    openGraph: {
      ...OG_DEFAULTS,
      title: fullTitle,
      description,
      url,
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description,
    },
  };
}

/**
 * Props for a native <script type="application/ld+json"> tag, per Next.js's
 * documented JSON-LD pattern: https://nextjs.org/docs/app/guides/json-ld
 * The `<` escape prevents untrusted data from breaking out of the script
 * context — harmless here since our JSON-LD is all static/trusted data, but
 * cheap to keep as the documented default.
 */
export function jsonLdScriptProps(data: unknown) {
  return {
    type: "application/ld+json" as const,
    dangerouslySetInnerHTML: {
      __html: JSON.stringify(data).replace(/</g, "\\u003c"),
    },
  };
}
