import { RequestAccessContent } from "./RequestAccessContent";
import { buildPageMetadata } from "@/lib/seo";

export const metadata = buildPageMetadata({
  title: "Request access",
  description:
    "Request early access to Fees101, the revenue operations platform for Nigerian schools. Tell us about your school and we will be in touch to get you set up.",
  path: "/request-access",
});

export default function RequestAccessPage() {
  return <RequestAccessContent />;
}
