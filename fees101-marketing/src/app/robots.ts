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
  "ClaudeBot", // Anthropic crawler
  "Claude-Web", // Anthropic live browsing
  "anthropic-ai", // Anthropic (legacy agent name)
  "Applebot-Extended", // Apple Intelligence content usage opt-in
  "Amazonbot", // Amazon (Alexa / AI) crawler
  "CCBot", // Common Crawl (feeds many models)
  "cohere-ai", // Cohere crawler
  "Meta-ExternalAgent", // Meta AI crawler
  "Google-CloudVertexBot", // Google Cloud Vertex AI on-demand fetch
  "DuckAssistBot", // DuckDuckGo DuckAssist
  "YouBot", // You.com
];

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
    // host tells crawlers the canonical host for this site; supported by the
    // documented Robots object.
    host: SITE_URL,
  };
}
