import { FaqContent } from "./FaqContent";
import { FAQS } from "./faqData";
import { buildPageMetadata, jsonLdScriptProps } from "@/lib/seo";

export const metadata = buildPageMetadata({
  title: "FAQ",
  description:
    "Answers to common questions about Fees101 — how payments and reconciliation work, security, pricing and getting early access.",
  path: "/faq",
});

// FAQPage schema, built from the same FAQS array the page renders — the
// structured data intentionally mirrors the visible copy rather than
// introducing separate wording. Note: Google deprecated FAQPage rich
// results in May 2026, so this no longer earns a Google snippet, but the
// schema is still valid, standard structured data for any other consumer.
const FAQ_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQS.map((item) => ({
    "@type": "Question",
    name: item.q,
    acceptedAnswer: {
      "@type": "Answer",
      text: item.a,
    },
  })),
};

export default function FaqPage() {
  return (
    <>
      <script {...jsonLdScriptProps(FAQ_JSON_LD)} />
      <FaqContent />
    </>
  );
}
