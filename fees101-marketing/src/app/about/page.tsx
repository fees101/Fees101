import { Reveal } from "@/components/Reveal";
import { StoryTimeline } from "./StoryTimeline";
import { TrustGrid } from "./TrustGrid";

export const metadata = { title: "About" };

export default function AboutPage() {
  return (
    <>
      <section className="relative overflow-hidden bg-white px-6 pb-10 pt-14">
        <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-mint-light/60 blur-3xl" />
        <div className="pointer-events-none absolute -right-24 top-0 h-72 w-72 rounded-full bg-[#eaf3ff] blur-3xl" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-10 md:grid-cols-[1.2fr_0.8fr]">
          <Reveal className="text-center md:text-left">
            <span className="mb-3 inline-block text-xs font-bold uppercase tracking-wider text-mint-dark">
              About
            </span>
            <h1 className="mb-4 text-3xl font-bold leading-tight text-navy sm:text-4xl">
              We got tired of fee collection running on memory and
              spreadsheets
            </h1>
            <p className="mx-auto mb-3 max-w-lg text-base leading-relaxed text-gray-500 md:mx-0">
              Fees101 started with a simple frustration schools kept
              repeating: fees tracked in notebooks and spreadsheets, payments
              confirmed by word of mouth, and no clear picture of who still
              owes what.
            </p>
            <p className="mx-auto max-w-lg text-base leading-relaxed text-gray-500 md:mx-0">
              We're building the system we wished existed — one that sets
              fees once, invoices every student automatically, and matches
              every payment the moment it lands.
            </p>
          </Reveal>

          <img
            src="/images/about-hero.png"
            alt="Fees101 invoice, payment confirmation and collection dashboard"
            className="mx-auto w-full max-w-[280px] md:max-w-none"
          />
        </div>
      </section>

      <TrustGrid />

      <StoryTimeline />

      <section className="border-t border-black/5 bg-white px-6 py-16 text-center">
        <Reveal>
          <h2 className="mb-3 text-2xl font-bold text-navy sm:text-3xl">
            Want to see it running at your school?
          </h2>
          <p className="mx-auto mb-7 max-w-lg text-[15px] leading-relaxed text-gray-500">
            We&apos;re onboarding a limited number of schools while we finish
            building. Reach out and we&apos;ll walk you through it.
          </p>
          <a
            href="mailto:support@fees101.com"
            className="inline-block rounded-xl bg-navy px-7 py-3.5 text-sm font-semibold text-white transition-transform hover:-translate-y-0.5"
          >
            support@fees101.com
          </a>
        </Reveal>
      </section>
    </>
  );
}
