import { Reveal } from "@/components/Reveal";
import { StepsAlternating } from "./StepsAlternating";
import { HeroVisual } from "./HeroVisual";

export const metadata = { title: "How it works" };

export default function HowItWorksPage() {
  return (
    <>
      <section className="relative overflow-hidden bg-white px-6 pb-4 pt-16">
        <div className="pointer-events-none absolute -right-40 -top-32 h-[420px] w-[420px] rounded-full bg-mint-light blur-3xl" />

        <div className="relative mx-auto grid max-w-6xl items-center gap-14 md:grid-cols-2">
          <Reveal className="text-center md:text-left">
            <span className="mb-3 inline-block text-xs font-bold uppercase tracking-wider text-mint-dark">
              How it works
            </span>
            <h1 className="mx-auto mb-4 max-w-lg text-4xl font-bold leading-tight text-navy sm:text-5xl md:mx-0">
              From fee structure to reconciled payment
            </h1>
            <p className="mx-auto max-w-md text-base leading-relaxed text-gray-500 md:mx-0">
              Six steps. No spreadsheets in between.
            </p>
          </Reveal>

          <HeroVisual />
        </div>
      </section>

      <StepsAlternating />

      <section className="bg-[#f6f9f8] px-6 py-16 text-center">
        <Reveal>
          <h2 className="mb-3 text-2xl font-bold text-navy sm:text-3xl">
            Want to see it running on your school&apos;s numbers?
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
