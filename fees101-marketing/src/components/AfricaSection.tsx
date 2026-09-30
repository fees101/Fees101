"use client";

import { Reveal } from "@/components/Reveal";

const FACTS = [
  { k: "Registered", v: "Bwari, FCT" },
  { k: "Company", v: "FEES101 LTD" },
  { k: "RC number", v: "9694725" },
  { k: "Data law", v: "NDPA 2023" },
  { k: "Next", v: "Pan-African expansion — coming soon" },
];

export function AfricaSection() {
  return (
    <section className="border-t-2 border-ink bg-ink px-6 py-20 text-paper">
      <div className="mx-auto grid max-w-6xl items-center gap-12 md:grid-cols-[1.1fr_0.9fr]">
        <Reveal>
          <span className="m-mono mb-3 block text-xs uppercase tracking-wider text-[#5ad8a6]">
            Where we operate
          </span>
          <h2 className="mb-4 text-3xl font-extrabold leading-tight sm:text-4xl">
            Built in Nigeria, for <span className="text-signal-text">Nigerian</span> schools.
          </h2>
          <p className="max-w-md text-base leading-relaxed text-neutral-300">
            Every part of Fees101 — the payment rails, the messaging, the
            compliance groundwork — is built around how Nigerian schools
            actually collect fees today, not a generic template borrowed from
            elsewhere.
          </p>
        </Reveal>

        <Reveal delay={0.1}>
          <dl className="flex flex-col border-t border-paper/30">
            {FACTS.map((f) => (
              <div
                key={f.k}
                className="flex items-baseline justify-between gap-4 border-b border-paper/15 py-3.5"
              >
                <dt className="m-mono text-[11px] uppercase tracking-wider text-neutral-400">
                  {f.k}
                </dt>
                <dd className="text-right font-heading text-xl font-bold text-paper">{f.v}</dd>
              </div>
            ))}
          </dl>
        </Reveal>
      </div>
    </section>
  );
}
