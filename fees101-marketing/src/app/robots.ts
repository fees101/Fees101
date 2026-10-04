import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

// AI / answer-engine crawlers we explicitly welcome, in addition to the
// catch-all "*" rule below. Listing them by name is belt-and-braces: the
// wildcard already allows them, but some of these agents only treat a site
// as opted-in when their own user-agent is named (Google-Extended and
// Applebot-Extended in particular are content-usage opt-ins that are
// *separate* from ordinary crawling). We want Fees101 discoverable and
// quotable by generative engines, so we allow all of them.
const AI_CRAWLERS = [
  "Google-Extended", // Google Gemini / Vertex AI content usage opt-in
  "GPTBot", // OpenAI training crawler
  "OAI-SearchBot", // OpenAI SearchGPT index
  "ChatGPT-User", // ChatGPT live browsing on a user's behalf
  "PerplexityBot", // Perplexity index
  "Perplexity-User", // Perplexity live fetch on a user's behalf
  "ClaudeBot", // Anthropic crawler (model development / training)
  "Claude-User", // Anthropic user-initiated fetch (a Claude user's query pulls this page)
  "Claude-SearchBot", // Anthropic search-indexing crawler (improves Claude search results)
  "Claude-Web", // Anthropic (legacy live-browse agent, superseded by Claude-User; kept for older bots)
  "anthropic-ai", // Anthropic (legacy agent name; kept for older bots)
  "Applebot-Extended", // Apple Intelligence content usage opt-in
  "Amazonbot", // Amazon (Alexa / AI) crawler
  "CCBot", // Common Crawl (feeds many models)
  "cohere-ai", // Cohere crawler
  "Meta-ExternalAgent", // Meta AI crawler
  "Google-CloudVertexBot", // Google Cloud Vertex AI on-demand fetch
  "DuckAssistBot", // DuckDuckGo DuckAssist
  "YouBot", // You.com
];

// Deliberately NOT listed: Brave Search's crawler. Brave powers Claude's web
// citations, but Brave states its crawler "does not advertise a differentiated
// user agent" (search.brave.com/help/brave-search-crawler), so there is no real
// UA to allow. Brave only crawls pages that are crawlable by Googlebot, which
// the catch-all "*" Allow: / rule below already satisfies. Do not invent one.

export default function robots(): MetadataRoute.Robots {
  return {
    // Array-of-rules form (per the local Next.js 16 docs). The first rule is
    // the usual catch-all; the second names the AI agents explicitly so the
    // opt-in-by-name crawlers see themselves allowed.
    rules: [
      {
        userAgent: "*",
        allow: "/",
      },
      {
        userAgent: AI_CRAWLERS,
        allow: "/",
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    // No `host` directive: it is a non-standard, Yandex-only robots.txt field
    // that Google/Bing reject as invalid (Bing's robots.txt tester flags it),
    // and it requires a bare hostname anyway. The canonical host (www) is
    // already enforced by the apex→www 308 redirect and the per-page
    // rel="canonical" tags, so the directive added nothing but an error.
  };
}
