import { FeaturesContent } from "./FeaturesContent";
import { buildPageMetadata } from "@/lib/seo";

export const metadata = buildPageMetadata({
  title: "Features",
  description:
    "Fee structures per class and term, automatic per-student invoicing, a dedicated virtual bank account per student, and a live collection dashboard.",
  path: "/features",
});

export default function FeaturesPage() {
  return <FeaturesContent />;
}
