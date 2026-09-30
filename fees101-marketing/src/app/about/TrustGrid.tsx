"use client";

import { Reveal } from "@/components/Reveal";

const TRUST = [
  {
    title: "Registered Nigerian company",
    body: "FEES101 LTD, RC 9694725, registered and operating out of Bwari, FCT, Nigeria.",
  },
  {
    title: "Bank-grade payment rails",
    body: "Every student gets their own dedicated virtual bank account, powered by licensed payment infrastructure — not a shared, ambiguous account.",
  },
  {
    title: "Data handled on your terms",
    body: "Schools stay the data controller for their students' information; we act strictly as a processor, on instruction. See our Privacy Policy.",
  },
  {
    title: "Nothing shipped untested",
    body: "Every workflow — bulk onboarding, payment reconciliation, notifications — is built with a test path that doesn't touch real money or real parents until it's proven.",
  },
];

export function TrustGrid() {
  return (
    <section className="border-t border-neutral-300 bg-surface px-6 py-16 sm:py-20">
      <div className="mx-auto max-w-6xl">
        <Reveal>
          <span className="m-mono mb-4 block text-xs uppercase tracking-wider text-signal-text">
            Trust &amp; compliance
          </span>
          <h2 className="mb-12 max-w-xl text-3xl font-extrabold leading-tight text-ink sm:text-4xl">
            Built for how Nigerian schools actually operate.
          </h2>
        </Reveal>

        <div className="grid grid-cols-1 border-t-2 border-ink sm:grid-cols-2 sm:gap-x-16">
          {TRUST.map((t) => (
            <Reveal key={t.title} className="border-b border-neutral-300 py-7">
              <h3 className="mb-2.5 text-2xl font-semibold leading-tight text-ink">{t.title}</h3>
              <p className="text-[15px] leading-relaxed text-neutral-800">{t.body}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
