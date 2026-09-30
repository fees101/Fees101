import { Reveal } from "@/components/Reveal";
import { StoryTimeline } from "./StoryTimeline";
import { TrustGrid } from "./TrustGrid";
import { ClosingCta } from "@/components/ClosingCta";
import { buildPageMetadata } from "@/lib/seo";

export const metadata = buildPageMetadata({
  title: "About",
  description:
    "Why we built Fees101 — a revenue operations platform for Nigerian schools tired of tracking fees in notebooks, spreadsheets and word of mouth.",
  path: "/about",
});

export default function AboutPage() {
  return (
    <>
      <section className="bg-paper px-6 pb-16 pt-20">
        <div className="mx-auto grid max-w-6xl items-end gap-10 md:grid-cols-[1.2fr_0.8fr]">
          <Reveal>
            <span className="m-mono mb-4 block text-xs uppercase tracking-wider text-signal-text">
              About
            </span>
            <h1 className="max-w-xl text-4xl font-extrabold leading-[1.05] tracking-tight text-ink sm:text-5xl">
              We got tired of revenue running on{" "}
              <span className="text-signal-text">memory</span> and
              spreadsheets.
            </h1>
          </Reveal>

          <Reveal delay={0.1} className="flex flex-col gap-4 md:self-end">
            <p className="text-base leading-relaxed text-neutral-700">
              Fees101 started with a simple frustration schools kept
              repeating: fees tracked in notebooks and spreadsheets, payments
              confirmed by word of mouth, and no clear picture of who still
              owes what.
            </p>
            <p className="text-base leading-relaxed text-neutral-700">
              We&apos;re building the system we wished existed — one that
              sets fees once, invoices every student automatically, and
              matches every payment the moment it lands.
            </p>
          </Reveal>
        </div>
      </section>

      <TrustGrid />

      <StoryTimeline />

      <ClosingCta
        head="Want to see it running at your school?"
        body="We're onboarding a limited number of schools while we finish building. Reach out and we'll walk you through it."
      />
    </>
  );
}
