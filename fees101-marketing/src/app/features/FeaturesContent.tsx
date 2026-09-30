"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Reveal, RevealStagger, RevealItem } from "@/components/Reveal";
import { ClosingCta } from "@/components/ClosingCta";

const TABS = [
  {
    key: "fees",
    label: "Fee structures",
    title: "Set fees once, apply them everywhere.",
    body: "Define tuition and levies per class and per term. Every student in that class inherits the right structure automatically — no re-entering the same numbers for 40 students one at a time.",
    points: [
      "Per-term, per-class fee items (tuition, levies, PTA dues, etc.)",
      "Changes to a class's structure apply to every student in it",
      "Historical terms stay untouched once invoiced",
    ],
  },
  {
    key: "invoicing",
    label: "Invoicing",
    title: "Every student, invoiced correctly, every time.",
    body: "Fees101 generates a per-student invoice from the class/term structure, and carries forward any unpaid balance into the next invoice automatically — nothing gets lost between terms.",
    points: [
      "One invoice per student per billing cycle",
      "Outstanding balances roll forward automatically",
      "Bulk invoice generation across an entire class or school",
    ],
  },
  {
    key: "payments",
    label: "Payments",
    title: "A dedicated bank account for every student.",
    body: "Each student gets their own virtual bank account, provisioned through licensed payment infrastructure. Parents pay by transfer like they always have — the difference is what happens next.",
    points: [
      "Dedicated virtual account per student — no shared or ambiguous accounts",
      "Parents keep paying exactly how they already do — a bank transfer, no new app to install",
      "Payments matched to the right student and invoice automatically",
      "Funds settle to the school's own account — Fees101 never holds school funds",
    ],
  },
  {
    key: "notifications",
    label: "Notifications",
    title: "Parents know before you have to chase them.",
    body: "SMS (and soon WhatsApp) notifications go out automatically for new invoices and payment confirmations, so admin staff stop being the messenger.",
    points: [
      "Invoice-ready and payment-received alerts, sent automatically",
      "Built on a provider-agnostic messaging layer",
      "Fully tested in a safe mock environment before a single naira is spent on messaging",
    ],
  },
  {
    key: "admin",
    label: "Admin & scale",
    title: "Built for one class — and for one thousand students.",
    body: "A live collection dashboard shows what's been collected and what's outstanding. Bulk CSV import and automatic account provisioning mean onboarding a whole school doesn't mean weeks of manual data entry.",
    points: [
      "CSV import for bulk student onboarding",
      "Automatic virtual-account provisioning, single or in bulk",
      "Paginated student directory that stays fast at hundreds of students",
      "Self-service payment settings — schools connect their own provider credentials",
    ],
  },
] as const;

const ENGINEERING = [
  {
    title: "Batched by design, not by accident",
    body: "Bulk imports and account provisioning run in small chunks with progress feedback, specifically so onboarding a 300+ student school doesn't hit a server timeout. We load-tested this with a real 400-student import.",
  },
  {
    title: "Safe to walk away from",
    body: "If an admin navigates away mid-import, the background work stops cleanly instead of silently continuing or corrupting data — a real bug we found and fixed during our own testing.",
  },
  {
    title: "Credentials encrypted at rest",
    body: "Every school's own payment provider keys are stored encrypted (AES-256-GCM), never in plaintext, and never exposed to the browser.",
  },
  {
    title: "Provider-agnostic by architecture",
    body: "Payment and messaging providers sit behind stable internal interfaces, so swapping or adding a provider later doesn't mean rewriting business logic.",
  },
  {
    title: "Tested before it costs money",
    body: "Our messaging pipeline has a full mock mode — every part of the compose-send-log flow is verified end to end before we spend a naira or need compliance sign-off to go live.",
  },
  {
    title: "Designed around Nigerian data law",
    body: "Data handling is built around the NDPA — schools stay the data controller for their students' information, and we act strictly as a processor on their instruction.",
  },
];

const INTEGRATIONS = [
  { name: "Monnify", note: "Payments" },
  { name: "Sendchamp", note: "SMS & WhatsApp" },
  { name: "More", note: "Coming soon" },
];

export function FeaturesContent() {
  const [active, setActive] = useState<(typeof TABS)[number]["key"]>("fees");
  const activeTab = TABS.find((t) => t.key === active)!;

  return (
    <>
      <section className="mx-auto max-w-6xl px-6 pb-10 pt-20">
        <Reveal>
          <span className="m-mono mb-4 block text-xs uppercase tracking-wider text-signal-text">
            Platform
          </span>
          <h1 className="mb-6 max-w-3xl text-4xl font-extrabold leading-[0.92] tracking-tight text-ink sm:text-5xl md:text-6xl">
            The full revenue cycle,{" "}
            <span className="text-signal">end to end.</span>
          </h1>
          <p className="max-w-xl text-lg leading-relaxed text-neutral-700">
            Not a spreadsheet replacement — a revenue operations system, from
            setting the fee schedule to knowing the money actually landed.
          </p>
        </Reveal>
      </section>

      <section className="border-t-2 border-ink">
        <div className="mx-auto grid max-w-6xl grid-cols-2 border-b-2 border-ink sm:grid-cols-5">
          {TABS.map((tab, i) => {
            const on = active === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActive(tab.key)}
                className={`flex flex-col gap-1.5 border-r border-neutral-300 px-3.5 py-4 text-left text-[15px] font-extrabold leading-tight tracking-tight transition-colors sm:px-4 ${
                  on ? "bg-ink text-paper" : "bg-paper text-ink hover:bg-surface"
                }`}
              >
                <span
                  className={`m-mono text-[11px] font-normal ${
                    on ? "text-[#5ad8a6]" : "text-signal-text"
                  }`}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="mx-auto max-w-6xl px-6 py-12 sm:py-16">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab.key}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="grid gap-9 md:grid-cols-[1fr_1.1fr] md:gap-20"
            >
              <div>
                <h2 className="mb-4 text-3xl font-extrabold leading-none tracking-tight text-ink sm:text-4xl">
                  {activeTab.title}
                </h2>
                <p className="max-w-md text-[15px] leading-relaxed text-neutral-700">
                  {activeTab.body}
                </p>
              </div>
              <ul className="flex flex-col self-start border-t-2 border-ink">
                {activeTab.points.map((point) => (
                  <li key={point} className="flex gap-3.5 border-b border-neutral-300 py-3.5">
                    <span className="m-mono shrink-0 text-[#0f7a55]">✓</span>
                    <span className="text-[15px] leading-relaxed text-neutral-800">{point}</span>
                  </li>
                ))}
              </ul>
            </motion.div>
          </AnimatePresence>
        </div>
      </section>

      <section className="border-t-2 border-ink bg-surface px-6 py-16 sm:py-24">
        <div className="mx-auto max-w-6xl">
          <Reveal>
            <span className="m-mono mb-3 block text-xs uppercase tracking-wider text-signal-text">
              Under the hood
            </span>
            <h2 className="mb-3 max-w-xl text-3xl font-extrabold leading-tight text-ink sm:text-4xl">
              The hard-to-see decisions that make this work.
            </h2>
            <p className="mb-9 max-w-lg text-[15px] leading-relaxed text-neutral-800">
              Software for money and school records has to be boring in the
              right way. Here&apos;s some of the thinking behind it.
            </p>
          </Reveal>

          <RevealStagger className="grid border-t-2 border-ink bg-paper sm:grid-cols-2">
            {ENGINEERING.map((item, i) => (
              <RevealItem key={item.title}>
                <div className="grid gap-x-10 gap-y-2 border-b border-neutral-300 p-5 sm:grid-cols-[minmax(260px,1fr)_minmax(260px,1fr)]">
                  <div className="flex items-baseline gap-4">
                    <span className="m-mono shrink-0 text-[11px] tracking-wider text-signal-text">
                      DR-{String(i + 1).padStart(2, "0")}
                    </span>
                    <h3 className="text-xl font-extrabold leading-tight tracking-tight text-ink">
                      {item.title}
                    </h3>
                  </div>
                  <p className="text-[15px] leading-relaxed text-neutral-800">{item.body}</p>
                </div>
              </RevealItem>
            ))}
          </RevealStagger>
        </div>
      </section>

      <section className="border-t-2 border-ink px-6 py-14">
        <Reveal className="mx-auto flex max-w-6xl flex-wrap items-center gap-8 sm:gap-14">
          <div className="min-w-[260px] flex-1">
            <span className="m-mono mb-2.5 block text-xs uppercase tracking-wider text-signal-text">
              Integrations
            </span>
            <h2 className="mb-2 text-2xl font-extrabold leading-tight tracking-tight text-ink sm:text-[28px]">
              Built to connect with what you already use.
            </h2>
            <p className="text-[15px] text-neutral-800">
              Trusted payment and messaging providers, behind interfaces we
              control.
            </p>
          </div>
          <div className="grid flex-[1.2_1_360px] grid-cols-3 border-t-2 border-ink">
            {INTEGRATIONS.map((i) => (
              <div key={i.name} className="py-4 pr-3">
                <div className="text-2xl font-extrabold tracking-tight text-ink sm:text-[26px]">
                  {i.name}
                </div>
                <div className="m-mono mt-1 text-[11px] text-neutral-600">{i.note}</div>
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      <ClosingCta
        head="Want to see it on your school's numbers?"
        body="We're onboarding a limited number of schools while we finish building. Reach out and we'll walk you through it."
      />
    </>
  );
}
