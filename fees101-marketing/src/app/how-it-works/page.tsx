import { Reveal } from "@/components/Reveal";
import { StepsAlternating } from "./StepsAlternating";
import { ClosingCta } from "@/components/ClosingCta";
import { buildPageMetadata } from "@/lib/seo";

export const metadata = buildPageMetadata({
  title: "How it works",
  description:
    "From fee structure to reconciled payment in six steps — how Fees101 invoices every student and matches every payment automatically, with no spreadsheets in between.",
  path: "/how-it-works",
});

export default function HowItWorksPage() {
  return (
    <>
      <section className="mx-auto max-w-6xl px-6 pb-12 pt-20">
        <Reveal>
          <span className="m-mono mb-4 block text-xs uppercase tracking-wider text-signal-text">
            How it works
          </span>
          <h1 className="mb-8 max-w-2xl text-4xl font-extrabold leading-[0.95] tracking-tight text-ink sm:text-5xl md:text-6xl">
            From fee structure to{" "}
            <span className="text-signal-text">reconciled</span> payment.
          </h1>
          <p className="max-w-xl text-lg leading-relaxed text-neutral-700">
            Six steps. No spreadsheets in between.
          </p>
        </Reveal>
      </section>

      <StepsAlternating />

      <ClosingCta
        head="Want to see it running on your school's numbers?"
        body="We're onboarding a limited number of schools while we finish building. Reach out and we'll walk you through it."
      />
    </>
  );
}
