import Link from "next/link";
import { Reveal } from "@/components/Reveal";

const REASSURANCE = ["Onboarding schools now", "65 free days every year", "Straight to our team"];

export function ClosingCta({
  eyebrow = "Early access",
  head,
  body,
}: {
  eyebrow?: string;
  head: string;
  body: string;
}) {
  return (
    <section className="border-t-2 border-ink bg-signal px-6 py-20 sm:py-28">
      <div className="mx-auto grid max-w-6xl gap-10 md:grid-cols-[1.3fr_1fr] md:items-end">
        <Reveal>
          <span className="m-mono mb-4 inline-block text-xs uppercase tracking-wider text-paper/80">
            {eyebrow}
          </span>
          <h2 className="max-w-xl text-5xl font-extrabold leading-[0.95] tracking-tight text-paper sm:text-6xl md:text-7xl">
            {head}
          </h2>
        </Reveal>

        <Reveal delay={0.1}>
          <p className="mb-6 max-w-sm text-base leading-relaxed text-paper/90">{body}</p>
          <Link href="/request-access" className="m-btn m-btn-ink-primary">
            Request access
          </Link>
          <p className="mt-5 text-sm text-paper/80">
            Or email us directly at{" "}
            <a
              href="mailto:support@fees101.com"
              className="break-all font-semibold text-paper underline decoration-2 underline-offset-4 decoration-paper/70 transition-colors hover:decoration-paper"
            >
              support@fees101.com
            </a>
          </p>
          <div className="m-mono mt-8 flex flex-wrap gap-x-8 gap-y-2 text-[13px] text-paper/80">
            {REASSURANCE.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
