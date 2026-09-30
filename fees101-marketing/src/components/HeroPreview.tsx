"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  DashboardView,
  InvoicingView,
  PaymentView,
  FeeStructureView,
  LedgerView,
} from "@/components/ProductScreens";

const VIEWS = [
  { label: "Dashboard", View: DashboardView },
  { label: "Invoices", View: InvoicingView },
  { label: "Payment", View: PaymentView },
  { label: "Fee structure", View: FeeStructureView },
  { label: "Ledger", View: LedgerView },
];

export function HeroPreview() {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setActive((i) => (i + 1) % VIEWS.length);
    }, 3400);
    return () => clearInterval(id);
  }, []);

  const ActiveView = VIEWS[active].View;

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      className="mx-auto max-w-2xl md:mx-0"
    >
      <div className="overflow-hidden border-2 border-ink bg-paper">
        <div className="flex items-center gap-1.5 border-b-2 border-ink bg-surface px-4 py-3">
          <span className="h-2.5 w-2.5 border border-ink" />
          <span className="h-2.5 w-2.5 border border-ink" />
          <span className="h-2.5 w-2.5 border border-ink" />
          <span className="ml-2 text-xs font-medium text-neutral-600">
            {VIEWS[active].label}
          </span>
        </div>
        <div className="relative min-h-[260px]">
          <AnimatePresence mode="wait">
            <motion.div
              key={VIEWS[active].label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            >
              <ActiveView />
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <div className="mt-5 flex justify-center gap-2">
        {VIEWS.map((v, i) => (
          <span
            key={v.label}
            className={`h-1.5 transition-all ${
              i === active ? "w-6 bg-signal" : "w-1.5 bg-ink/15"
            }`}
          />
        ))}
      </div>
    </motion.div>
  );
}
