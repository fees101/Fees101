import type { MetadataRoute } from "next";

const SITE_URL = "https://www.fees101.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const routes = ["", "/features", "/how-it-works", "/about", "/faq", "/privacy", "/terms"];
  return routes.map((route) => ({
    url: `${SITE_URL}${route}`,
    lastModified: new Date("2026-07-24"),
  }));
}
