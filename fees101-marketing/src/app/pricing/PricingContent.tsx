"use client";

import { Reveal, RevealStagger, RevealItem } from "@/components/Reveal";
import { ClosingCta } from "@/components/ClosingCta";

const INCLUDED = [
  "Fee schedules per class and term",
  "Per-student invoices with balances carried forward",
  "A dedicated virtual account for every student",
  "Family accounts that group siblings under one shared account, so a parent can pay once",
  "Automatic payment reconciliation",
  "Live collection dashboard",
  "SMS notifications (WhatsApp coming soon)",
  "Bulk CSV student onboarding",
  "Self-service payment provider settings",
  "Encrypted provider credentials (AES-256-GCM)",
  "A direct line to our team",
];

const KNOW = [
  {
    title: "Fees101 never holds school funds",
    body: "Payments settle through our payment infrastructure partner directly to the school's own designated account.",
  },
  {
    title: "Provider terms apply",
    body: "Payments and messaging run on licensed third-party providers, subject to their own terms.",
  },
  {
    title: "Parents change nothing",
    body: "Same bank app, same transfer. No new app to install.",
  },
];

const PRICE_FAQS = [
  {
    q: "How can my school get early access?",
    a: "Reach out to support@fees101.com and we'll get you set up as part of our early onboarding.",
  },
  {
    q: "Does Fees101 hold our money?",
    a: "No. Fees101 does not hold school funds. Payments are settled through our payment infrastructure partner directly to the school's own designated settlement account.",
  },
  {
    q: "Do parents need to download an app or change how they pay?",
    a: "No. Parents keep paying exactly how they already do — a regular bank transfer, from whatever banking app they normally use. The only difference is they're transferring into their own child's dedicated account instead of a shared one, and it's the school's side that's now organised — everything is matched and recorded automatically.",
  },
];

export function PricingContent() {
  return (
    <>
      <section className="mx-auto max-w-6xl px-6 pb-10 pt-20">
        <Reveal>
          <span className="m-mono mb-4 block text-xs uppercase tracking-wider text-signal-text">
            Pricing
          </span>
          <h1 className="mb-6 max-w-2xl text-4xl font-extrabold leading-[0.92] tracking-tight text-ink sm:text-5xl md:text-6xl">
            Quoted to <span className="text-signal">your school.</span>
          </h1>
          <p className="max-w-xl text-lg leading-relaxed text-neutral-700">
            We&apos;re onboarding a limited number of schools while we finish
            building. Pricing is confirmed with each school during
            onboarding.
          </p>
        </Reveal>
      </section>

      <section className="border-t-2 border-ink">
        <div className="mx-auto grid max-w-6xl sm:grid-cols-2">
          <div className="flex flex-col gap-4 border-b border-neutral-300 p-8 sm:border-b-0 sm:border-r sm:border-neutral-300 sm:p-12">
            <div className="flex items-baseline justify-between">
              <span className="m-mono text-xs uppercase tracking-wider text-ink">
                Early access
              </span>
              <span className="tag tag-accent">Available now</span>
            </div>
            <div className="font-heading text-6xl font-extrabold leading-[0.95] tracking-tight text-ink sm:text-7xl">
              ₦ —
            </div>
            <div className="m-mono text-xs text-neutral-700">
              per student, per term — to be confirmed
            </div>
            <p className="max-w-sm text-[15px] leading-relaxed text-neutral-700">
              Everything on the platform, set up with our team. Rates are
              agreed per school before you go live.
            </p>
            <div>
              <a href="mailto:support@fees101.com" className="m-btn m-btn-primary">
                Request a quote
              </a>
            </div>
          </div>

          <div className="flex flex-col gap-4 bg-surface p-8 sm:p-12">
            <div className="flex items-baseline justify-between">
              <span className="m-mono text-xs uppercase tracking-wider text-ink">
                General availability
              </span>
              <span className="tag tag-outline">Coming soon</span>
            </div>
            <div className="font-heading text-4xl font-extrabold leading-none tracking-tight text-neutral-600 sm:text-5xl">
              Published at launch
            </div>
            <p className="max-w-sm text-[15px] leading-relaxed text-neutral-700">
              We&apos;ll publish public pricing when general sign-up opens.
              Tell us you&apos;re interested and we&apos;ll write when it
              does.
            </p>
            <div>
              <a href="mailto:support@fees101.com" className="m-btn m-btn-outline">
                Get notified
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t-2 border-ink px-6 py-16 sm:py-24">
        <div className="mx-auto max-w-6xl">
          <Reveal>
            <span className="m-mono mb-3 block text-xs uppercase tracking-wider text-signal-text">
              Included
            </span>
            <h2 className="mb-9 max-w-xl text-3xl font-extrabold leading-tight text-ink sm:text-4xl">
              The whole platform, not a menu of add-ons.
            </h2>
          </Reveal>

          <RevealStagger className="grid border-t-2 border-ink sm:grid-cols-2 sm:gap-x-14">
            {INCLUDED.map((item) => (
              <RevealItem key={item}>
                <div className="flex gap-3.5 border-b border-neutral-300 py-3.5">
                  <span className="m-mono shrink-0 text-[#0f7a55]">✓</span>
                  <span className="text-[15px] text-neutral-800">{item}</span>
                </div>
              </RevealItem>
            ))}
          </RevealStagger>
        </div>
      </section>

      <section className="border-t-2 border-ink bg-surface px-6 py-16 sm:py-24">
        <div className="mx-auto max-w-6xl">
          <Reveal className="mb-5">
            <span className="m-mono block text-xs uppercase tracking-wider text-signal-text">
              Good to know
            </span>
          </Reveal>

          <RevealStagger className="grid border-t-2 border-ink sm:grid-cols-3">
            {KNOW.map((k) => (
              <RevealItem key={k.title}>
                <div className="py-5 pr-6">
                  <h3 className="mb-2 text-xl font-extrabold leading-tight tracking-tight text-ink">
                    {k.title}
                  </h3>
                  <p className="text-[15px] leading-relaxed text-neutral-800">{k.body}</p>
                </div>
              </RevealItem>
            ))}
          </RevealStagger>

          <div className="mt-8 border-t-2 border-ink">
            {PRICE_FAQS.map((f) => (
              <div
                key={f.q}
                className="grid gap-2 border-b border-neutral-300 py-5 sm:grid-cols-2 sm:gap-10"
              >
                <div className="text-[19px] font-extrabold leading-tight tracking-tight text-ink">
                  {f.q}
                </div>
                <p className="text-[15px] text-neutral-700">{f.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <ClosingCta
        head="Let's scope your school."
        body="Tell us roughly how many students you have and we'll come back with a quote."
      />
    </>
  );
}
