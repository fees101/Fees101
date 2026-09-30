"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { Reveal, RevealStagger, RevealItem } from "@/components/Reveal";
import { Counter } from "@/components/Counter";
import { HeroPreview } from "@/components/HeroPreview";
import { AfricaSection } from "@/components/AfricaSection";
import { ClosingCta } from "@/components/ClosingCta";
import { SITE_URL, SITE_NAME, jsonLdScriptProps } from "@/lib/seo";

// SoftwareApplication + Offer schema for the product itself. No
// aggregateRating/review fields are included since we have no real ratings
// to report — inventing one would make this ineligible for (and a
// misrepresentation to) any consumer that checks structured data honesty.
const SOFTWARE_APPLICATION_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: SITE_NAME,
  applicationCategory: "BusinessApplication",
  applicationSubCategory: "School revenue operations",
  operatingSystem: "Web",
  url: SITE_URL,
  description:
    "Fees101 is a revenue operations platform for Nigerian schools — invoicing, payment tracking, automated reconciliation and a dedicated virtual bank account per student.",
  offers: {
    "@type": "Offer",
    url: `${SITE_URL}/pricing`,
    priceCurrency: "NGN",
    priceSpecification: {
      "@type": "UnitPriceSpecification",
      priceCurrency: "NGN",
      unitText: "per student, per term — confirmed with each school during onboarding",
    },
    availability: "https://schema.org/LimitedAvailability",
  },
  provider: {
    "@type": "Organization",
    name: SITE_NAME,
    url: SITE_URL,
  },
};

const HIGHLIGHTS = [
  {
    title: "Fee structures per term and class",
    body: "Set tuition and levies once per class and term, applied consistently to every student in it.",
  },
  {
    title: "Per-student invoicing",
    body: "Automatic invoices with any outstanding balance carried forward to the next term.",
  },
  {
    title: "Automated reconciliation",
    body: "Payments are matched to the right student and invoice the moment they land — no manual chasing.",
  },
  {
    title: "Collection dashboard",
    body: "A live view of what's collected, what's outstanding, and who needs a nudge.",
  },
  {
    title: "SMS + WhatsApp reminders",
    body: "Parents get notified the moment an invoice goes out or a payment is confirmed.",
  },
  {
    title: "Bulk student onboarding",
    body: "Import an entire school's student list from a CSV in minutes, not one form at a time.",
  },
];

const STATS = [
  {
    n: 400,
    u: "+",
    label: "students onboarded in a single import during load testing",
  },
  {
    n: 90,
    u: "s",
    label: "for that entire 400-student batch to fully provision",
  },
  {
    n: 100,
    u: "%",
    label: "of student payments auto-reconciled — no spreadsheets",
  },
];

const PAIN_POINTS = [
  {
    before: "Payments confirmed by screenshot and WhatsApp messages",
    after: "Every payment auto-matched to the right student the moment it lands.",
  },
  {
    before: "No one knows who's paid until someone checks manually",
    after: "A live dashboard shows exactly who's paid and who's outstanding.",
  },
  {
    before: "Reminding parents means calling or texting one by one",
    after: "Automatic SMS + WhatsApp reminders for every unpaid invoice.",
  },
  {
    before: "Fee structures re-entered by hand for every student",
    after: "Set it once per class — every student inherits it automatically.",
  },
  {
    before: "Spreadsheets that fall out of sync between staff",
    after: "One system, one source of truth, updated in real time.",
  },
];

export default function HomePage() {
  return (
    <>
      <script {...jsonLdScriptProps(SOFTWARE_APPLICATION_JSON_LD)} />

      {/* Hero */}
      <section className="bg-paper px-6 pb-24 pt-20">
        <div className="mx-auto grid max-w-6xl items-center gap-14 md:grid-cols-[1fr_1.15fr]">
          <div>
            <motion.span
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15, duration: 0.5 }}
              className="m-mono mb-6 block text-xs uppercase tracking-wider text-signal-text"
            >
              Revenue operations platform · Nigeria
            </motion.span>

            <motion.h1
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25, duration: 0.6 }}
              className="mb-5 max-w-lg text-4xl font-extrabold leading-[0.95] tracking-tight text-ink sm:text-5xl md:text-6xl"
            >
              Revenue, <span className="text-signal-text">reconciled</span> in
              real time.
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35, duration: 0.6 }}
              className="mb-8 max-w-xl text-lg leading-relaxed text-neutral-700"
            >
              Fees101 is a revenue operations platform for Nigerian schools:
              invoicing, collections and automatic reconciliation on one
              ledger — every payment matched to its invoice the moment it
              lands.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.45, duration: 0.6 }}
              className="flex flex-wrap gap-3"
            >
              <a href="mailto:support@fees101.com" className="m-btn m-btn-primary">
                Talk to us
              </a>
              <Link href="/how-it-works" className="m-btn m-btn-outline">
                See how it works
              </Link>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.55, duration: 0.6 }}
              className="mt-6 flex items-center gap-2 text-sm text-neutral-600"
            >
              <ShieldCheck size={15} className="text-ink" />
              Secure. Reliable. Built for schools.
            </motion.div>
          </div>

          <HeroPreview />
        </div>
      </section>

      {/* Pain points */}
      <section className="border-t-2 border-ink bg-surface px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <Reveal className="mb-10">
            <span className="m-mono mb-4 block text-xs uppercase tracking-wider text-signal-text">
              Sound familiar?
            </span>
            <h2 className="max-w-md text-3xl font-extrabold leading-tight text-ink sm:text-5xl">
              Revenue ops shouldn&apos;t run on screenshots.
            </h2>
          </Reveal>

          <div className="grid grid-cols-2 gap-6 border-t-2 border-ink pt-3 text-xs font-bold uppercase tracking-widest sm:gap-14">
            <div className="text-neutral-500">Before</div>
            <div className="text-signal-text">With Fees101</div>
          </div>

          <RevealStagger className="flex flex-col">
            {PAIN_POINTS.map((p) => (
              <RevealItem key={p.before}>
                <div className="grid grid-cols-2 gap-6 border-t border-neutral-300 py-6 sm:gap-14">
                  <p className="text-neutral-500 line-through decoration-neutral-400">
                    {p.before}
                  </p>
                  <p className="text-lg font-semibold leading-snug text-ink sm:text-2xl">
                    {p.after}
                  </p>
                </div>
              </RevealItem>
            ))}
          </RevealStagger>
        </div>
      </section>

      {/* What we do */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <Reveal className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <span className="m-mono mb-3 block text-xs uppercase tracking-wider text-signal-text">
              What we do
            </span>
            <h2 className="max-w-xl text-3xl font-extrabold text-ink sm:text-4xl">
              The whole revenue cycle, on one ledger.
            </h2>
          </div>
          <Link href="/features" className="m-btn m-btn-outline">
            Explore all features <ArrowRight size={15} />
          </Link>
        </Reveal>

        <RevealStagger className="mt-10 flex flex-col">
          {HIGHLIGHTS.map((h, i) => (
            <RevealItem key={h.title}>
              <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2 border-t border-neutral-300 py-6">
                <span className="m-mono w-12 shrink-0 text-[13px] text-signal-text">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="flex-1 basis-[280px] text-xl font-extrabold text-ink sm:text-2xl">
                  {h.title}
                </h3>
                <p className="flex-1 basis-[300px] max-w-[34em] text-[15px] leading-relaxed text-neutral-700">
                  {h.body}
                </p>
              </div>
            </RevealItem>
          ))}
          <div className="border-t border-neutral-300" />
        </RevealStagger>
      </section>

      <AfricaSection />

      {/* Real numbers from real testing */}
      <section className="bg-paper px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <Reveal className="mb-14 flex flex-wrap items-end justify-between gap-4">
            <h2 className="max-w-xl text-3xl font-extrabold leading-tight text-ink sm:text-4xl">
              We stress-test this before a school ever sees it.
            </h2>
            <span className="m-mono text-xs uppercase tracking-wider text-signal-text">
              Figures from load testing
            </span>
          </Reveal>

          <div className="grid gap-x-0 gap-y-10 border-t-2 border-ink pt-8 sm:grid-cols-3">
            {STATS.map((s, i) => (
              <Reveal
                key={s.label}
                className={`px-0 ${i > 0 ? "sm:border-l sm:border-neutral-300 sm:pl-10" : ""}`}
              >
                <div className="font-heading text-6xl font-extrabold leading-none tracking-tight text-ink sm:text-7xl">
                  <Counter to={s.n} />
                  <span className="text-signal-text">{s.u}</span>
                </div>
                <p className="mt-4 max-w-[220px] text-sm leading-relaxed text-neutral-700">
                  {s.label}
                </p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <ClosingCta
        head="We're building Fees101 right now."
        body="If you run a school in Nigeria and want early access, reach out — we'd love to hear from you."
      />
    </>
  );
}
