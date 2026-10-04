import { PricingContent } from "./PricingContent";
import { buildPageMetadata, jsonLdScriptProps, SITE_URL, SITE_NAME } from "@/lib/seo";

export const metadata = buildPageMetadata({
  title: "Pricing",
  description:
    "Fees101 early-access pricing: a one-time ₦10,000 setup fee, then ₦500 per active student per month, with 65 free days every year (about ₦5,000 per student a year), billed daily and collected by bank direct debit.",
  path: "/pricing",
});

// Early-access pricing. The free period recurs yearly (~65 free days per
// 365-day cycle from onboarding), so a year is ~₦5,000/student (10 billed
// months), never 12x the monthly rate. Do not add a 12x annual figure here.
const OFFER_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Offer",
  url: `${SITE_URL}/pricing`,
  name: "Fees101 subscription (early access)",
  priceCurrency: "NGN",
  description:
    "Early-access pricing: ₦500 per active student per month plus a one-time ₦10,000 setup fee. 65 free days every year (about two months), so a year is about ₦5,000 per active student, roughly ten billed months. Billed daily on active students and collected by bank direct debit.",
  priceSpecification: {
    "@type": "UnitPriceSpecification",
    price: "500",
    priceCurrency: "NGN",
    unitText: "per active student, per month",
    referenceQuantity: {
      "@type": "QuantitativeValue",
      value: 1,
      unitText: "active student",
    },
  },
  addOn: {
    "@type": "Offer",
    name: "One-time setup fee",
    priceCurrency: "NGN",
    price: "10000",
    description: "One-time, nonrefundable fee to connect a school to the platform.",
  },
  availability: "https://schema.org/InStock",
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
