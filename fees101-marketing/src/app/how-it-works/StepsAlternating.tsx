"use client";

import { motion } from "framer-motion";

const STEPS = [
  {
    title: "School onboards",
    label: "School setup",
    body: "An admin account is created and the school's profile is set up — classes, terms, and staff access.",
    rows: [
      ["School", "Greenfield College"],
      ["Classes", "JSS 1 – SS 3"],
      ["Terms", "First · Second · Third"],
      ["Staff access", "3 administrators"],
    ],
  },
  {
    title: "Fee structure is configured",
    label: "Fee structure",
    body: "Tuition and levies are set per class and per term, once — every student in that class inherits it.",
    rows: [
      ["Tuition", "₦150,000"],
      ["Development levy", "₦20,000"],
      ["PTA dues", "₦15,000"],
      ["JSS 1 · Second term", "₦185,000"],
    ],
  },
  {
    title: "Invoices are generated",
    label: "Invoice",
    body: "Per-student invoices are created automatically, with any prior outstanding balance carried forward.",
    rows: [
      ["Student", "Ngozi Adeyemi"],
      ["Second term fees", "₦185,000"],
      ["Carried forward", "₦47,500"],
      ["Amount due", "₦232,500"],
    ],
  },
  {
    title: "Parent pays",
    label: "Payment",
    body: "Nothing changes for the parent — same bank app, same transfer they already do. It just lands in their child's own dedicated account instead of a shared, unlabeled one.",
    rows: [
      ["Pay to", "Ngozi Adeyemi's account"],
      ["Channel", "Bank transfer"],
      ["Amount", "₦232,500"],
      ["New app needed", "None"],
    ],
  },
  {
    title: "Payment is auto-reconciled",
    label: "Reconciliation",
    body: "The payment is matched to the right student and invoice the moment it lands. No spreadsheets, no manual matching.",
    rows: [
      ["Matched to", "Ngozi Adeyemi"],
      ["Invoice", "Second term"],
      ["Balance", "₦0"],
      ["Matched in", "Instantly"],
    ],
  },
  {
    title: "The dashboard updates, live",
    label: "Dashboard",
    body: "Admin staff see collections and outstanding balances update in real time, and know exactly who to remind.",
    rows: [
      ["Students paid", "4 of 6"],
      ["Collected", "₦787,500"],
      ["Outstanding", "₦370,000"],
      ["Reminders queued", "2"],
    ],
  },
];

export function StepsAlternating() {
  return (
    <div className="mx-auto max-w-6xl px-6">
      {STEPS.map((step, i) => {
        const reversed = i % 2 === 1;
        return (
          <section
            key={step.title}
            className="border-t-2 border-ink py-12 sm:py-16"
          >
            <div className="grid items-center gap-10 md:grid-cols-2 md:gap-16">
              <motion.div
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-100px" }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                className={reversed ? "md:order-2" : ""}
              >
                <div className="mb-2 font-heading text-7xl font-extrabold leading-[0.85] text-signal sm:text-8xl">
                  {String(i + 1).padStart(2, "0")}
                </div>
                <h2 className="mb-4 text-2xl font-semibold leading-none text-ink sm:text-[32px]">
                  {step.title}
                </h2>
                <p className="max-w-md text-[15px] leading-relaxed text-neutral-700">
                  {step.body}
                </p>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-100px" }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                className={reversed ? "md:order-1" : ""}
              >
                <div className="border border-neutral-300 border-t-2 border-t-ink bg-paper p-6 sm:p-8">
                  <div className="mb-3 flex items-baseline justify-between gap-3 border-b border-neutral-300 pb-3">
                    <span className="m-mono text-xs uppercase tracking-wider text-signal-text">
                      {step.label}
                    </span>
                    <span className="text-xs text-neutral-600">Specimen</span>
                  </div>
                  {step.rows.map(([k, v]) => (
                    <div
                      key={k}
                      className="flex items-baseline justify-between gap-6 border-b border-neutral-300 py-3 last:border-b-0"
                    >
                      <span className="text-[15px] text-neutral-700">{k}</span>
                      <span className="m-mono text-right text-[15px] text-ink">{v}</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
