"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { School, Check, Layers, Wallet, TrendingUp } from "lucide-react";

const CHART_POINTS = "0,60 40,50 80,55 120,38 160,42 200,24 240,28 280,10";
const VIEWPORT = { once: true, margin: "-40px" } as const;

function StatusPill({ status }: { status: string }) {
  const paid = status === "Paid";
  return (
    <span
      className={`border px-2 py-0.5 text-[10px] font-semibold ${
        paid
          ? "border-ledger/30 bg-transparent text-ledger"
          : "border-ochre/30 bg-transparent text-ochre-text"
      }`}
    >
      {status}
    </span>
  );
}

export function OnboardingView() {
  return (
    <div className="p-5">
      <div className="mb-4 flex items-center gap-3 border-2 border-ink p-3">
        <div className="flex h-10 w-10 items-center justify-center border-2 border-ink bg-ink">
          <School size={18} className="text-signal" />
        </div>
        <div>
          <p className="text-[12px] font-semibold text-ink">Greenfield Academy</p>
          <p className="text-[10px] text-neutral-600">School profile</p>
        </div>
      </div>
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-600">
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
            className="flex items-center justify-between border border-neutral-300 px-3 py-2 text-[12px] text-neutral-700"
          >
            {cls}
            <Check size={13} className="text-signal" />
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
        <span className="text-xs font-semibold text-ink">Term 2 fee structure</span>
        <Layers size={14} className="text-neutral-600" />
      </div>
      <div className="flex flex-col gap-2">
        {rows.map((r, i) => (
          <motion.div
            key={r.cls}
            initial={{ opacity: 0, x: 12 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={VIEWPORT}
            transition={{ delay: i * 0.1, duration: 0.4 }}
            className="flex items-center justify-between border border-neutral-300 px-3 py-2.5"
          >
            <span className="text-[12px] font-semibold text-ink">{r.cls}</span>
            <span className="text-[12px] font-semibold text-ink">{r.amount}</span>
          </motion.div>
        ))}
      </div>
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={VIEWPORT}
        transition={{ delay: 0.4, duration: 0.4 }}
        className="mt-3 border-2 border-ink bg-ink px-3 py-2 text-center text-[11px] font-semibold text-paper"
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
        <span className="text-xs font-semibold text-ink">Term 2 invoices</span>
        <span className="border-2 border-ink px-2.5 py-1 text-[10px] font-semibold text-ink">
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
            className="flex items-center justify-between border border-neutral-300 px-3 py-2.5"
          >
            <div>
              <p className="text-[12px] font-semibold text-ink">{inv.student}</p>
              <p className="text-[10px] text-neutral-600">{inv.id}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-semibold text-ink">{inv.amount}</span>
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
        <span className="text-xs font-semibold text-ink">Chioma&apos;s virtual account</span>
        <Wallet size={14} className="text-neutral-600" />
      </div>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={VIEWPORT}
        transition={{ duration: 0.4 }}
        className="border-2 border-dashed border-ink p-4 text-center"
      >
        <p className="text-[10px] font-semibold uppercase tracking-wide text-signal-text">
          Transfer to
        </p>
        <p className="mt-1 text-[15px] font-bold text-ink">8123 456 789</p>
        <p className="text-[11px] text-neutral-700">Wema Bank · Chioma A. (Fees101)</p>
      </motion.div>
      <motion.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: [0, 1, 0.4, 1] }}
        viewport={VIEWPORT}
        transition={{ delay: 0.6, duration: 1.4 }}
        className="mt-3 flex items-center justify-center gap-2 text-[11px] font-semibold text-neutral-600"
      >
        Waiting for transfer…
      </motion.div>
    </div>
  );
}

const LEDGER_STUDENTS: [string, number][] = [
  ["Amara Okafor", 185000],
  ["Tunde Bello", 185000],
  ["Zainab Sani", 185000],
  ["Chidi Eze", 185000],
  ["Ngozi Adeyemi", 232500],
  ["Ibrahim Musa", 185000],
];

const money = (n: number) => "₦" + n.toLocaleString("en-NG");

export function LedgerView() {
  const [matched, setMatched] = useState(3);

  useEffect(() => {
    const id = setInterval(() => {
      setMatched((m) => (m >= 6 ? 2 : m + 1));
    }, 2400);
    return () => clearInterval(id);
  }, []);

  const total = LEDGER_STUDENTS.reduce((sum, [, amount]) => sum + amount, 0);
  const collected = LEDGER_STUDENTS.slice(0, matched).reduce((sum, [, amount]) => sum + amount, 0);
  const [lastName, lastAmount] = LEDGER_STUDENTS[matched - 1];

  return (
    <div className="m-mono bg-ink text-[13px] text-[#e8f8f1]">
      <div className="flex items-center justify-between gap-4 border-b border-[#e8f8f1]/25 px-4 py-3 text-[11px] text-[#a4e6cb]">
        <span>ledger / jss-1 / term-2</span>
        <span className="flex items-center gap-1.5 text-[#5ad8a6]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#5ad8a6]" />
          live · illustrative data
        </span>
      </div>

      <div className="flex flex-col">
        {LEDGER_STUDENTS.map(([name, amount], i) => {
          const isMatched = i < matched;
          const isFresh = i === matched - 1;
          return (
            <div
              key={name}
              className={`flex items-center justify-between gap-3 border-b border-[#e8f8f1]/10 px-4 py-2.5 ${
                isFresh ? "bg-[#5ad8a6]/10" : ""
              }`}
            >
              <span className="w-[68px] shrink-0 text-[11px] text-[#e8f8f1]/50">
                INV-{2040 + i}
              </span>
              <span className="flex-1 truncate text-[13px] font-bold text-[#e8f8f1]">{name}</span>
              <span
                className={`w-16 shrink-0 text-[11px] tracking-wide ${
                  isMatched ? "text-[#5ad8a6]" : "text-[#e8f8f1]/50"
                }`}
              >
                {isMatched ? "MATCHED" : "PENDING"}
              </span>
              <span className="shrink-0 text-[13px] text-[#e8f8f1]">{money(amount)}</span>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-4 px-4 py-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-[#e8f8f1]/50">Collected</div>
          <div className="mt-0.5 text-lg font-bold text-[#5ad8a6]">{money(collected)}</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-widest text-[#e8f8f1]/50">
            Outstanding
          </div>
          <div className="mt-0.5 text-lg font-bold text-[#e8f8f1]">{money(total - collected)}</div>
        </div>
      </div>

      <div className="border-t border-[#e8f8f1]/10 bg-[#181615] px-4 py-2.5 text-[11px] text-[#5ad8a6]">
        › payment.received → matched {lastName} {money(lastAmount)}
      </div>
    </div>
  );
}

export function DashboardView() {
  return (
    <div className="p-5">
      <div className="mb-5 grid grid-cols-3 gap-3">
        <div className="border border-neutral-300 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-600">
            Collected
          </p>
          <p className="mt-1 text-[15px] font-bold text-ledger">₦26.7M</p>
        </div>
        <div className="border border-neutral-300 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-600">
            Outstanding
          </p>
          <p className="mt-1 text-[15px] font-bold text-ink">₦3.4M</p>
        </div>
        <div className="border-2 border-ink bg-ink p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-300">
            Collection
          </p>
          <p className="mt-1 text-[15px] font-bold text-paper">89%</p>
        </div>
      </div>
      <div className="border border-neutral-300 p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs font-semibold text-ink">Collection overview</span>
          <span className="flex items-center gap-1 text-[11px] font-semibold text-ledger">
            <TrendingUp size={12} /> +12%
          </span>
        </div>
        <svg viewBox="0 0 280 70" className="h-16 w-full overflow-visible">
          <motion.polyline
            points={CHART_POINTS}
            fill="none"
            stroke="#201e1d"
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
