import { WhyFees101Content } from "./WhyFees101Content";
import { buildPageMetadata } from "@/lib/seo";

export const metadata = buildPageMetadata({
  title: "Why Fees101",
  description:
    "Fees101 compared with a shared school account and spreadsheets: where school revenue leaks on reconciliation, fake-alert fraud, outstanding balances, parent reminders and reporting, and what a revenue operations platform does differently.",
  path: "/why-fees101",
});

export default function WhyFees101Page() {
  return <WhyFees101Content />;
}
