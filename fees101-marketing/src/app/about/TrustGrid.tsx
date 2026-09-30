"use client";

import { Building2, ShieldCheck, Lock, FlaskConical } from "lucide-react";
import { Reveal, RevealStagger, RevealItem } from "@/components/Reveal";
import { IconBadge } from "@/components/IconBadge";
import { TiltCard } from "@/components/TiltCard";

const TRUST_POINTS = [
  {
    icon: Building2,
    title: "Registered Nigerian company",
    body: "FEES101 LTD, RC 9694725, registered and operating out of Bwari, FCT, Nigeria.",
  },
  {
    icon: ShieldCheck,
    title: "Bank-grade payment rails",
    body: "Every student gets their own dedicated virtual bank account, powered by licensed payment infrastructure — not a shared, ambiguous account.",
  },
  {
    icon: Lock,
    title: "Data handled on your terms",
    body: "Schools stay the data controller for their students' information; we act strictly as a processor, on instruction. See our Privacy Policy.",
  },
  {
    icon: FlaskConical,
    title: "Nothing shipped untested",
    body: "Every workflow — bulk onboarding, payment reconciliation, notifications — is built with a test path that doesn't touch real money or real parents until it's proven.",
  },
];

export function TrustGrid() {
  return (
    <section className="bg-[#f6f9f8] px-6 py-20">
      <div className="mx-auto max-w-5xl">
        <Reveal className="mx-auto mb-12 max-w-xl text-center">
          <span className="mb-3 inline-block text-xs font-bold uppercase tracking-wider text-mint-dark">
            Trust &amp; compliance
          </span>
          <h2 className="text-3xl font-bold text-navy sm:text-4xl">
            Built for how Nigerian schools actually operate
          </h2>
        </Reveal>

        <RevealStagger className="grid gap-5 sm:grid-cols-2">
          {TRUST_POINTS.map((t) => (
            <RevealItem key={t.title}>
              <TiltCard className="h-full rounded-2xl border border-black/5 bg-white p-7">
                <IconBadge icon={t.icon} className="mb-3" />
                <h3 className="mb-2 text-[16px] font-bold text-navy">{t.title}</h3>
                <p className="text-sm leading-relaxed text-gray-500">{t.body}</p>
              </TiltCard>
            </RevealItem>
          ))}
        </RevealStagger>
      </div>
    </section>
  );
}
