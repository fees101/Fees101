"use client";

import { Globe2 } from "lucide-react";
import { Reveal } from "@/components/Reveal";
import { NigeriaMap } from "@/components/NigeriaMap";

export function AfricaSection() {
  return (
    <section className="mx-auto max-w-5xl px-6 py-20">
      <div className="grid items-center gap-12 md:grid-cols-2">
        <Reveal>
          <span className="mb-3 inline-block text-xs font-bold uppercase tracking-wider text-mint-dark">
            Where we operate
          </span>
          <h2 className="mb-4 text-3xl font-bold text-navy sm:text-4xl">
            Built in Nigeria, for Nigerian schools
          </h2>
          <p className="mb-5 text-base leading-relaxed text-gray-500">
            Every part of Fees101 — the payment rails, the messaging, the
            compliance groundwork — is built around how Nigerian schools
            actually collect fees today, not a generic template borrowed from
            elsewhere.
          </p>
          <div className="inline-flex items-center gap-2 rounded-full border border-mint-dark/30 bg-mint-light px-4 py-2 text-[13px] font-semibold text-mint-dark">
            <Globe2 size={15} />
            Pan-African expansion — coming soon
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <NigeriaMap />
        </Reveal>
      </div>
    </section>
  );
}
