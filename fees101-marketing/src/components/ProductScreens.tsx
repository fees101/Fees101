"use client";

import { motion } from "framer-motion";
import {
  School,
  Check,
  Layers,
  Wallet,
  ArrowRight,
  CheckCircle2,
  TrendingUp,
} from "lucide-react";

const CHART_POINTS = "0,60 40,50 80,55 120,38 160,42 200,24 240,28 280,10";
const VIEWPORT = { once: true, margin: "-40px" } as const;

function StatusPill({ status }: { status: string }) {
  const paid = status === "Paid";
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
        paid ? "bg-mint-light text-mint-dark" : "bg-amber-50 text-amber-600"
      }`}
    >
      {status}
    </span>
  );
}

export function OnboardingView() {
  return (
    <div className="p-5">
      <div className="mb-4 flex items-center gap-3 rounded-xl border border-black/5 p-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-navy">
          <School size={18} className="text-mint" />
        </div>
        <div>
          <p className="text-[12px] font-semibold text-navy">Greenfield Academy</p>
          <p className="text-[10px] text-gray-400">School profile</p>
        </div>
      </div>
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
        Classes
      </p>
      <div className="flex flex-col gap-2">
        {["JSS 1", "JSS 2", "JSS 3", "SS 1"].map((cls, i) => (
          <motion.div
            key={cls}
            initial={{ opacity: 0, x: 12 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={VIEWPORT}
            transition={{ delay: i * 0.08, duration: 0.4 }}
            className="flex items-center justify-between rounded-lg border border-black/5 px-3 py-2 text-[12px] text-gray-600"
          >
            {cls}
            <Check size={13} className="text-mint-dark" />
          </motion.div>
        ))}
      </div>
    </div>
  );
}

export function FeeStructureView() {
  const rows = [
    { cls: "JSS 1", amount: "₦85,000" },
    { cls: "JSS 2", amount: "₦85,000" },
    { cls: "SS 1", amount: "₦92,500" },
  ];
  return (
    <div className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold text-navy">Term 2 fee structure</span>
        <Layers size={14} className="text-gray-400" />
      </div>
      <div className="flex flex-col gap-2">
        {rows.map((r, i) => (
          <motion.div
            key={r.cls}
            initial={{ opacity: 0, x: 12 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={VIEWPORT}
            transition={{ delay: i * 0.1, duration: 0.4 }}
            className="flex items-center justify-between rounded-lg border border-black/5 px-3 py-2.5"
          >
            <span className="text-[12px] font-semibold text-navy">{r.cls}</span>
            <span className="text-[12px] font-semibold text-mint-dark">{r.amount}</span>
          </motion.div>
        ))}
      </div>
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={VIEWPORT}
        transition={{ delay: 0.4, duration: 0.4 }}
        className="mt-3 rounded-lg bg-mint-light px-3 py-2 text-center text-[11px] font-semibold text-mint-dark"
      >
        Applied to 142 students automatically
      </motion.div>
    </div>
  );
}

export function InvoicingView() {
  const invoices = [
    { id: "INV-0231", student: "Chioma A.", amount: "₦85,000", status: "Paid" },
    { id: "INV-0232", student: "Tunde O.", amount: "₦85,000", status: "Paid" },
    { id: "INV-0233", student: "Amaka N.", amount: "₦92,500", status: "Due" },
  ];
  return (
    <div className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold text-navy">Term 2 invoices</span>
        <span className="rounded-full bg-mint-light px-2.5 py-1 text-[10px] font-semibold text-mint-dark">
          142 generated
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {invoices.map((inv, i) => (
          <motion.div
            key={inv.id}
            initial={{ opacity: 0, x: 12 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={VIEWPORT}
            transition={{ delay: i * 0.1, duration: 0.4 }}
            className="flex items-center justify-between rounded-lg border border-black/5 px-3 py-2.5"
          >
            <div>
              <p className="text-[12px] font-semibold text-navy">{inv.student}</p>
              <p className="text-[10px] text-gray-400">{inv.id}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-semibold text-navy">{inv.amount}</span>
              <StatusPill status={inv.status} />
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

export function PaymentView() {
  return (
    <div className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold text-navy">Chioma&apos;s virtual account</span>
        <Wallet size={14} className="text-gray-400" />
      </div>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={VIEWPORT}
        transition={{ duration: 0.4 }}
        className="rounded-xl border border-dashed border-mint-dark/40 bg-mint-light/40 p-4 text-center"
      >
        <p className="text-[10px] font-semibold uppercase tracking-wide text-mint-dark">
          Transfer to
        </p>
        <p className="mt-1 text-[15px] font-bold text-navy">8123 456 789</p>
        <p className="text-[11px] text-gray-500">Wema Bank · Chioma A. (Fees101)</p>
      </motion.div>
      <motion.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: [0, 1, 0.4, 1] }}
        viewport={VIEWPORT}
        transition={{ delay: 0.6, duration: 1.4 }}
        className="mt-3 flex items-center justify-center gap-2 text-[11px] font-semibold text-gray-400"
      >
        Waiting for transfer…
      </motion.div>
    </div>
  );
}

export function ReconciliationView() {
  return (
    <div className="p-5">
      <div className="mb-4 flex items-center justify-between text-[11px] font-semibold text-gray-400">
        <span>Payment</span>
        <span>Invoice</span>
      </div>
      <div className="relative flex items-center justify-between">
        <motion.div
          initial={{ opacity: 0, x: -10 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={VIEWPORT}
          transition={{ duration: 0.4 }}
          className="w-[42%] rounded-lg border border-black/5 p-3"
        >
          <p className="text-[12px] font-bold text-navy">₦85,000</p>
          <p className="text-[10px] text-gray-400">Wema Bank transfer</p>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, scale: 0.5 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={VIEWPORT}
          transition={{ delay: 0.4, duration: 0.4, type: "spring" }}
          className="absolute left-1/2 top-1/2 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-mint-dark text-white"
        >
          <ArrowRight size={13} />
        </motion.div>
        <motion.div
          initial={{ opacity: 0, x: 10 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={VIEWPORT}
          transition={{ duration: 0.4 }}
          className="w-[42%] rounded-lg border border-black/5 p-3"
        >
          <p className="text-[12px] font-bold text-navy">INV-0231</p>
          <p className="text-[10px] text-gray-400">Chioma A. — JSS 1</p>
        </motion.div>
      </div>
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={VIEWPORT}
        transition={{ delay: 0.8, duration: 0.4 }}
        className="mt-5 flex items-center justify-center gap-2 rounded-lg bg-mint-light py-2.5 text-[12px] font-semibold text-mint-dark"
      >
        <CheckCircle2 size={14} />
        Matched &amp; reconciled automatically
      </motion.div>
    </div>
  );
}

export function DashboardView() {
  return (
    <div className="p-5">
      <div className="mb-5 grid grid-cols-3 gap-3">
        <div className="rounded-xl bg-[#f6f9f8] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            Collected
          </p>
          <p className="mt-1 text-[15px] font-bold text-navy">₦26.7M</p>
        </div>
        <div className="rounded-xl bg-[#f6f9f8] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            Outstanding
          </p>
          <p className="mt-1 text-[15px] font-bold text-navy">₦3.4M</p>
        </div>
        <div className="rounded-xl bg-mint-light p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-mint-dark">
            Collection
          </p>
          <p className="mt-1 text-[15px] font-bold text-mint-dark">89%</p>
        </div>
      </div>
      <div className="rounded-xl border border-black/5 p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs font-semibold text-navy">Collection overview</span>
          <span className="flex items-center gap-1 text-[11px] font-semibold text-mint-dark">
            <TrendingUp size={12} /> +12%
          </span>
        </div>
        <svg viewBox="0 0 280 70" className="h-16 w-full overflow-visible">
          <defs>
            <linearGradient id="chartFillStep" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#5ad8a6" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#5ad8a6" stopOpacity="0" />
            </linearGradient>
          </defs>
          <motion.polygon
            points={`0,70 ${CHART_POINTS} 280,70`}
            fill="url(#chartFillStep)"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={VIEWPORT}
            transition={{ duration: 0.8 }}
          />
          <motion.polyline
            points={CHART_POINTS}
            fill="none"
            stroke="#3fbe8e"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: 0 }}
            whileInView={{ pathLength: 1 }}
            viewport={VIEWPORT}
            transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
          />
        </svg>
      </div>
    </div>
  );
}
