"use client";

import { useState } from "react";
import Link from "next/link";
import { Reveal, RevealStagger, RevealItem } from "@/components/Reveal";
import { ClosingCta } from "@/components/ClosingCta";

// Early-access pricing (figures mirror fees101-web's platformBilling config).
// The free period RECURS every year: ~65 free days + ~300 billed days per
// 365-day cycle, anchored to onboarding. So a school pays for ~10 months a
// year, which is why the annual figure is students x PER_STUDENT_YEAR
// (monthly x 10), NOT monthly x 12. Do not reintroduce a 12x annual.
const SETUP_FEE = 10000; // one-time, nonrefundable (naira)
const PER_STUDENT_MONTH = 500; // per active student, per in-session month (naira)
const PER_STUDENT_YEAR = 5000; // per active student, per year = 10 billed months (naira)
const FREE_DAYS = 65;
const EXAMPLE_ROWS = [50, 100, 250, 500, 1000];

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
    q: "What does Fees101 cost?",
    a: "Early-access pricing is a one-time setup fee of ₦10,000 to connect your school, then ₦500 per active student per in-session month. You get 65 days free every year, about two months, so you pay for roughly ten months a year. Billing is worked out daily on your active students and collected automatically by bank direct debit.",
  },
  {
    q: "How do the 65 free days work?",
    a: "The free days recur every year, not just at the start. Each 365-day cycle from when you onboard includes about 65 free days (roughly two months) and about 300 billed days. Because of that, a full year works out to about ₦5,000 per active student, not twelve times the monthly figure.",
  },
  {
    q: "Is there a contract or a minimum term?",
    a: "No long-term contract. Billing is calculated daily on your active students and collected by bank direct debit. These are the current early-access terms; general-availability pricing will be confirmed later.",
  },
  {
    q: "Does Fees101 hold our money?",
    a: "No. Fees101 does not hold school funds. Payments are settled through our payment infrastructure partner directly to the school's own designated settlement account.",
  },
  {
    q: "Do parents need to download an app or change how they pay?",
    a: "No. Parents keep paying exactly how they already do, a regular bank transfer from whatever banking app they normally use. The only difference is they are transferring into their own child's dedicated account instead of a shared one, and the school's side is now organised, with everything matched and recorded automatically.",
  },
];

function formatNaira(amount: number): string {
  return `₦${amount.toLocaleString("en-NG")}`;
}

function PricingCalculator() {
  // Hold the raw field as a string so it can be fully cleared (empty string)
  // and never gets a stuck leading zero from coercing an empty value back to 0.
  // Coerce to a number only for the maths.
  const [raw, setRaw] = useState("200");
  const safeStudents = parseInt(raw.replace(/\D/g, ""), 10) || 0;
  const monthly = safeStudents * PER_STUDENT_MONTH;
  const annual = safeStudents * PER_STUDENT_YEAR;

  return (
    <div className="border-2 border-ink bg-paper p-6 sm:p-8">
      <span className="m-mono mb-4 block text-xs uppercase tracking-wider text-signal-text">
        Estimate your cost
      </span>

      <label htmlFor="student-count" className="mb-2 block text-[15px] font-semibold text-ink">
        Number of active students
      </label>
      <input
        id="student-count"
        type="number"
        min={0}
        step={1}
        inputMode="numeric"
        value={raw}
        onChange={(e) => setRaw(e.target.value.replace(/\D/g, "").replace(/^0+(?=\d)/, ""))}
        className="mb-6 w-full max-w-[220px] border-2 border-neutral-400 bg-paper px-3 py-2 text-lg font-semibold text-ink tabular-nums transition-colors focus:border-ink"
      />

      <div className="grid gap-5 border-t-2 border-ink pt-6 sm:grid-cols-2">
        <div>
          <span className="m-mono block text-xs uppercase tracking-wider text-neutral-600">
            Monthly estimate
          </span>
          <div className="font-heading text-4xl font-extrabold leading-none tracking-tight text-ink tabular-nums sm:text-5xl">
            {formatNaira(monthly)}
          </div>
          <span className="mt-1 block text-[13px] text-neutral-700 tabular-nums">
            {safeStudents.toLocaleString("en-NG")} students x {formatNaira(PER_STUDENT_MONTH)}
          </span>
        </div>
        <div>
          <span className="m-mono block text-xs uppercase tracking-wider text-neutral-600">
            Annual estimate
          </span>
          <div className="font-heading text-4xl font-extrabold leading-none tracking-tight text-ink tabular-nums sm:text-5xl">
            {formatNaira(annual)}
          </div>
          <span className="mt-1 block text-[13px] text-neutral-700">
            About 2 months free every year, so you pay for roughly 10 months
          </span>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-x-8 gap-y-2 border-t border-neutral-300 pt-5 text-[14px] text-neutral-800">
        <span className="tabular-nums">
          One-time setup fee: <strong>{formatNaira(SETUP_FEE)}</strong>
        </span>
        <span className="tabular-nums">
          {FREE_DAYS} days free every year
        </span>
      </div>

      <p className="mt-4 text-[13px] leading-relaxed text-neutral-600">
        These are estimates. You get {FREE_DAYS} free days every year (about two months) on a
        recurring 365-day cycle from when you onboard. Billing is calculated daily and pro-rated on
        your active students, and the {formatNaira(SETUP_FEE)} setup fee is charged once to connect
        your school.
      </p>
    </div>
  );
}

export function PricingContent() {
  return (
    <>
      <section className="mx-auto max-w-6xl px-6 pb-10 pt-20">
        <Reveal>
          <span className="m-mono mb-4 block text-xs uppercase tracking-wider text-signal-text">
            Early-access pricing
          </span>
          <h1 className="mb-6 max-w-2xl text-4xl font-extrabold leading-[0.92] tracking-tight text-ink sm:text-5xl md:text-6xl">
            Pay for the students{" "}
            <span className="text-signal">you actually have.</span>
          </h1>
          <p className="max-w-xl text-lg leading-relaxed text-neutral-700">
            One simple rate, the whole platform, no long-term contract. Fees101 is live and
            onboarding schools now.
          </p>
        </Reveal>
      </section>

      <section className="border-t-2 border-ink">
        <div className="mx-auto grid max-w-6xl sm:grid-cols-2">
          <div className="flex flex-col gap-4 border-b border-neutral-300 p-8 sm:border-b-0 sm:border-r sm:border-neutral-300 sm:p-12">
            <div className="flex items-baseline justify-between">
              <span className="m-mono text-xs uppercase tracking-wider text-ink">
                Per active student
              </span>
              <span className="tag tag-accent">Early access</span>
            </div>
            <div className="font-heading text-6xl font-extrabold leading-[0.95] tracking-tight text-ink tabular-nums sm:text-7xl">
              ₦500
            </div>
            <div className="m-mono text-xs text-neutral-700">
              per active student, per month
            </div>
            <p className="max-w-sm text-[15px] leading-relaxed text-neutral-700">
              The whole platform, billed daily on your active students and collected automatically by
              bank direct debit. You get {FREE_DAYS} days free every year, about two months.
            </p>
            <div>
              <Link href="/request-access" className="m-btn m-btn-primary">
                Request access
              </Link>
            </div>
          </div>

          <div className="flex flex-col gap-4 bg-surface p-8 sm:p-12">
            <div className="flex items-baseline justify-between">
              <span className="m-mono text-xs uppercase tracking-wider text-ink">
                One-time setup
              </span>
              <span className="tag tag-outline">Once</span>
            </div>
            <div className="font-heading text-6xl font-extrabold leading-[0.95] tracking-tight text-ink tabular-nums sm:text-7xl">
              ₦10,000
            </div>
            <div className="m-mono text-xs text-neutral-700">
              one-time, nonrefundable
            </div>
            <p className="max-w-sm text-[15px] leading-relaxed text-neutral-700">
              A single setup fee to connect your school and provision billing. There is no
              long-term contract after that.
            </p>
            <div>
              <Link href="/request-access" className="m-btn m-btn-outline">
                Talk to us
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t-2 border-ink px-6 py-16 sm:py-24">
        <div className="mx-auto max-w-6xl">
          <Reveal>
            <span className="m-mono mb-3 block text-xs uppercase tracking-wider text-signal-text">
              Work out your cost
            </span>
            <h2 className="mb-9 max-w-xl text-3xl font-extrabold leading-tight text-ink sm:text-4xl">
              See roughly what Fees101 costs your school.
            </h2>
          </Reveal>

          <Reveal>
            <div className="max-w-2xl">
              <PricingCalculator />
            </div>
          </Reveal>

          <Reveal>
            <div className="mt-12">
              <h3 className="mb-4 text-xl font-extrabold tracking-tight text-ink">
                Worked examples
              </h3>
              <div className="overflow-x-auto border-t-2 border-ink">
                <table className="w-full min-w-[480px] border-collapse text-left tabular-nums">
                  <caption className="sr-only">
                    Monthly and annual estimates at ₦500 per active student per month. The annual
                    figure reflects about two free months every year (you pay for roughly ten
                    months) and excludes the one-time ₦10,000 setup fee.
                  </caption>
                  <thead>
                    <tr className="border-b border-neutral-300">
                      <th scope="col" className="m-mono py-3 pr-6 text-xs font-normal uppercase tracking-wider text-neutral-600">
                        Students
                      </th>
                      <th scope="col" className="m-mono py-3 pr-6 text-xs font-normal uppercase tracking-wider text-neutral-600">
                        Monthly
                      </th>
                      <th scope="col" className="m-mono py-3 text-xs font-normal uppercase tracking-wider text-neutral-600">
                        Annual
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {EXAMPLE_ROWS.map((count) => (
                      <tr key={count} className="border-b border-neutral-300">
                        <th scope="row" className="py-4 pr-6 text-[15px] font-extrabold text-ink">
                          {count.toLocaleString("en-NG")}
                        </th>
                        <td className="py-4 pr-6 text-[15px] text-neutral-800">
                          {formatNaira(count * PER_STUDENT_MONTH)}
                        </td>
                        <td className="py-4 text-[15px] text-neutral-800">
                          {formatNaira(count * PER_STUDENT_YEAR)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-4 text-[13px] leading-relaxed text-neutral-600">
                Estimates at ₦500 per active student per month. The annual figure reflects about two
                free months every year, so you pay for roughly ten months (about ₦5,000 per active
                student a year), not twelve times the monthly figure. Figures exclude the one-time
                ₦10,000 setup fee, and actual billing is pro-rated daily on your active students.
              </p>
            </div>
          </Reveal>
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
        head="Ready to get started?"
        body="Tell us roughly how many students you have and we'll get your school set up."
      />
    </>
  );
}
