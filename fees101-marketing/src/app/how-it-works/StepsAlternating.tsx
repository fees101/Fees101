"use client";

import { motion } from "framer-motion";
import {
  School,
  ClipboardList,
  Receipt,
  CreditCard,
  CheckCircle2,
  BarChart3,
} from "lucide-react";
import { TiltCard } from "@/components/TiltCard";
import {
  OnboardingView,
  FeeStructureView,
  InvoicingView,
  PaymentView,
  ReconciliationView,
  DashboardView,
} from "@/components/ProductScreens";

const STEPS = [
  {
    icon: School,
    title: "School onboards",
    body: "An admin account is created and the school's profile is set up — classes, terms, and staff access.",
    View: OnboardingView,
    label: "School setup",
  },
  {
    icon: ClipboardList,
    title: "Fee structure is configured",
    body: "Tuition and levies are set per class and per term, once — every student in that class inherits it.",
    View: FeeStructureView,
    label: "Fee structure",
  },
  {
    icon: Receipt,
    title: "Invoices are generated",
    body: "Per-student invoices are created automatically, with any prior outstanding balance carried forward.",
    View: InvoicingView,
    label: "Invoices",
  },
  {
    icon: CreditCard,
    title: "Parent pays",
    body: "Nothing changes for the parent — same bank app, same transfer they already do. It just lands in their child's own dedicated account instead of a shared, unlabeled one.",
    View: PaymentView,
    label: "Payment",
  },
  {
    icon: CheckCircle2,
    title: "Payment is auto-reconciled",
    body: "The payment is matched to the right student and invoice the moment it lands. No spreadsheets, no manual matching.",
    View: ReconciliationView,
    label: "Reconciliation",
  },
  {
    icon: BarChart3,
    title: "The dashboard updates, live",
    body: "Admin staff see collections and outstanding balances update in real time, and know exactly who to remind.",
    View: DashboardView,
    label: "Dashboard",
  },
];

export function StepsAlternating() {
  return (
    <div className="mx-auto max-w-6xl">
      {STEPS.map((step, i) => {
        const reversed = i % 2 === 1;
        return (
          <section
            key={step.title}
            className="border-t border-black/5 px-6 py-16 first:border-t-0 sm:py-20"
          >
            <div className="grid items-center gap-10 md:grid-cols-2 md:gap-16">
              <motion.div
                initial={{ opacity: 0, x: reversed ? 48 : -48 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, margin: "-100px" }}
                transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                className={reversed ? "md:order-2" : ""}
              >
                <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-full border-2 border-mint bg-white text-sm font-bold text-navy">
                  {i + 1}
                </div>
                <div className="mb-1 flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-mint-light">
                    <step.icon size={18} strokeWidth={2} color="#3fbe8e" />
                  </div>
                  <h3 className="text-lg font-bold text-navy sm:text-xl">{step.title}</h3>
                </div>
                <p className="max-w-md text-sm leading-relaxed text-gray-500 sm:text-[15px]">
                  {step.body}
                </p>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, x: reversed ? -48 : 48 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, margin: "-100px" }}
                transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                className={reversed ? "md:order-1" : ""}
              >
                <TiltCard className="overflow-hidden rounded-2xl border border-black/5 bg-white shadow-xl shadow-navy/10">
                  <div className="flex items-center gap-1.5 border-b border-black/5 bg-[#f6f9f8] px-4 py-3">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
                    <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
                    <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
                    <span className="ml-2 text-xs font-medium text-gray-400">
                      {step.label}
                    </span>
                  </div>
                  <step.View />
                </TiltCard>
              </motion.div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
