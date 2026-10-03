"use client";

import { Reveal, RevealStagger, RevealItem } from "@/components/Reveal";
import { ClosingCta } from "@/components/ClosingCta";

// Each row contrasts the common setup (one shared school account plus a
// spreadsheet) with Fees101 on a single dimension. Claims are framed as how
// each approach works, not as measured outcomes, so nothing here is a
// fabricated metric.
const ROWS = [
  {
    aspect: "Reconciliation effort",
    old: "Someone reads a single shared account statement and matches each transfer to a student by hand, often from a narration parents typed themselves.",
    fees101:
      "Each student pays into their own dedicated virtual account, so every payment is matched to the right student and invoice automatically.",
  },
  {
    aspect: "Fake-alert fraud risk",
    old: "A transfer screenshot or bank SMS can be edited or forged. A student can be marked paid before the money has actually settled.",
    fees101:
      "Every payment is confirmed by a verified webhook from the licensed payment partner before it is recorded. A forged alert creates no payment record.",
  },
  {
    aspect: "Outstanding-balance tracking",
    old: "Balances live in formulas someone has to maintain, and carrying an unpaid balance into next term is a manual copy that is easy to get wrong.",
    fees101:
      "Each invoice tracks its own balance, and any unpaid amount is carried forward to the next invoice automatically.",
  },
  {
    aspect: "Paying for several children",
    old: "A parent with three children makes three transfers, or one lump sum that staff then split across three students by hand.",
    fees101:
      "Siblings can share one family account, so a parent pays once and the transfer is applied across each child's invoices automatically.",
  },
  {
    aspect: "Parent reminders",
    old: "Admin staff call or message parents one at a time, when there is time, and there usually is not.",
    fees101:
      "SMS notifications for new invoices and payment confirmations go out automatically (WhatsApp coming soon).",
  },
  {
    aspect: "Reporting",
    old: "Collected-versus-outstanding is a report someone has to compile, and it is out of date the moment it is shared.",
    fees101:
      "A live collection dashboard shows what has been collected and what is outstanding at any moment.",
  },
];

// The places money quietly slips out of a shared-account setup, stated as the
// problem each one causes rather than a figure.
const LEAKS = [
  {
    title: "Payments matched to the wrong student",
    body: "When 300 families transfer into one account with free-text narration, a mistyped name or admission number lands money against the wrong child, or against no one at all.",
  },
  {
    title: "Paid on a screenshot that never cleared",
    body: "Trusting a forwarded alert instead of a settled transfer means a student can sit in class on a payment that was edited, duplicated, or never arrived.",
  },
  {
    title: "Balances that quietly disappear between terms",
    body: "An unpaid balance that is not carried forward by hand is a balance the school has effectively written off without deciding to.",
  },
  {
    title: "Arrears nobody is chasing",
    body: "Without automatic reminders, the follow-up depends on whoever has a free afternoon, so the slowest-paying accounts are the ones that get chased least.",
  },
];

export function WhyFees101Content() {
  return (
    <>
      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 pb-10 pt-20">
        <Reveal>
          <span className="m-mono mb-4 block text-xs uppercase tracking-wider text-signal-text">
            Comparison
          </span>
          <h1 className="mb-6 max-w-3xl text-4xl font-extrabold leading-[0.92] tracking-tight text-ink sm:text-5xl md:text-6xl">
            Where school revenue{" "}
            <span className="text-signal">leaks.</span>
          </h1>
          <p className="max-w-xl text-lg leading-relaxed text-neutral-700">
            Most schools collect fees into one shared bank account and track
            them in a spreadsheet. It works until it does not. Here is where the
            money slips through, and what a revenue operations platform does
            differently.
          </p>
        </Reveal>
      </section>

      {/* Machine-readable comparison table */}
      <section className="border-t-2 border-ink px-6 py-16 sm:py-24">
        <div className="mx-auto max-w-6xl">
          <Reveal>
            <span className="m-mono mb-3 block text-xs uppercase tracking-wider text-signal-text">
              Side by side
            </span>
            <h2 className="mb-9 max-w-xl text-3xl font-extrabold leading-tight text-ink sm:text-4xl">
              Shared account and spreadsheets, versus Fees101.
            </h2>
          </Reveal>

          <Reveal>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left align-top">
                <caption className="sr-only">
                  Comparison of a shared school account with spreadsheets
                  against Fees101, across reconciliation effort, fake-alert
                  fraud risk, outstanding-balance tracking, parent reminders and
                  reporting.
                </caption>
                <thead>
                  <tr className="border-y-2 border-ink">
                    <th
                      scope="col"
                      className="m-mono w-[18%] py-4 pr-6 align-bottom text-xs font-normal uppercase tracking-wider text-neutral-600"
                    >
                      Dimension
                    </th>
                    <th
                      scope="col"
                      className="w-[41%] py-4 pr-6 align-bottom"
                    >
                      <span className="m-mono block text-[11px] uppercase tracking-wider text-signal-text">
                        Shared account + spreadsheets
                      </span>
                    </th>
                    <th scope="col" className="w-[41%] py-4 align-bottom">
                      <span className="m-mono block text-[11px] uppercase tracking-wider text-[#0f7a55]">
                        Fees101
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map((row) => (
                    <tr
                      key={row.aspect}
                      className="border-b border-neutral-300"
                    >
                      <th
                        scope="row"
                        className="py-5 pr-6 align-top text-[15px] font-extrabold leading-tight tracking-tight text-ink"
                      >
                        {row.aspect}
                      </th>
                      <td className="py-5 pr-6 align-top text-[15px] leading-relaxed text-neutral-700">
                        {row.old}
                      </td>
                      <td className="py-5 align-top text-[15px] leading-relaxed text-neutral-800">
                        {row.fees101}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Where the money leaks */}
      <section className="border-t-2 border-ink bg-surface px-6 py-16 sm:py-24">
        <div className="mx-auto max-w-6xl">
          <Reveal>
            <span className="m-mono mb-3 block text-xs uppercase tracking-wider text-signal-text">
              The leaks
            </span>
            <h2 className="mb-3 max-w-xl text-3xl font-extrabold leading-tight text-ink sm:text-4xl">
              Four ways a shared account loses money.
            </h2>
            <p className="mb-9 max-w-lg text-[15px] leading-relaxed text-neutral-800">
              None of these need bad intent. They are what happens when the
              record of who paid lives in a different place from the money
              itself.
            </p>
          </Reveal>

          <RevealStagger className="grid border-t-2 border-ink bg-paper sm:grid-cols-2">
            {LEAKS.map((leak, i) => (
              <RevealItem key={leak.title}>
                <div className="grid gap-x-10 gap-y-2 border-b border-neutral-300 p-5 sm:grid-cols-[minmax(220px,1fr)_minmax(220px,1fr)]">
                  <div className="flex items-baseline gap-4">
                    <span className="m-mono shrink-0 text-[11px] tracking-wider text-signal-text">
                      LK-{String(i + 1).padStart(2, "0")}
                    </span>
                    <h3 className="text-xl font-extrabold leading-tight tracking-tight text-ink">
                      {leak.title}
                    </h3>
                  </div>
                  <p className="text-[15px] leading-relaxed text-neutral-800">
                    {leak.body}
                  </p>
                </div>
              </RevealItem>
            ))}
          </RevealStagger>
        </div>
      </section>

      {/* Positioning close */}
      <section className="border-t-2 border-ink px-6 py-16 sm:py-24">
        <div className="mx-auto grid max-w-6xl gap-9 md:grid-cols-[1fr_1.1fr] md:gap-20">
          <Reveal>
            <h2 className="text-3xl font-extrabold leading-none tracking-tight text-ink sm:text-4xl">
              Not a spreadsheet replacement.
            </h2>
          </Reveal>
          <Reveal delay={0.1}>
            <p className="max-w-md text-[15px] leading-relaxed text-neutral-700">
              Fees101 is a revenue operations platform for Nigerian schools. It
              connects the money to the record: a dedicated virtual account per
              student, payments verified before they count, balances that carry
              forward on their own, and a live view of what has landed. The
              spreadsheet was never the problem. The gap between the spreadsheet
              and the bank account was.
            </p>
          </Reveal>
        </div>
      </section>

      <ClosingCta
        head="See it on your school's numbers."
        body="We're onboarding a limited number of schools while we finish building. Tell us roughly how many students you have and we'll walk you through it."
      />
    </>
  );
}
