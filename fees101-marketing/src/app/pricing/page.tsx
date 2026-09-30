import { PricingContent } from "./PricingContent";
import { buildPageMetadata, jsonLdScriptProps, SITE_URL, SITE_NAME } from "@/lib/seo";

export const metadata = buildPageMetadata({
  title: "Pricing",
  description:
    "Fees101 pricing is quoted per school during onboarding. See what's included and how it works.",
  path: "/pricing",
});

const OFFER_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Offer",
  url: `${SITE_URL}/pricing`,
  priceCurrency: "NGN",
  priceSpecification: {
    "@type": "UnitPriceSpecification",
    priceCurrency: "NGN",
    unitText: "per student, per term — confirmed with each school during onboarding",
  },
  availability: "https://schema.org/LimitedAvailability",
  seller: {
    "@type": "Organization",
    name: SITE_NAME,
    url: SITE_URL,
  },
};

export default function PricingPage() {
  return (
    <>
      <script {...jsonLdScriptProps(OFFER_JSON_LD)} />
      <PricingContent />
    </>
  );
}
