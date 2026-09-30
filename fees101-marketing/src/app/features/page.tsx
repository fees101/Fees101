"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ClipboardList,
  Receipt,
  CreditCard,
  Bell,
  LayoutDashboard,
  Layers,
  ShieldCheck,
  Lock,
  Plug,
  FlaskConical,
  Landmark,
  Wallet,
  MessageSquare,
} from "lucide-react";
import { Reveal, RevealStagger, RevealItem } from "@/components/Reveal";
import { IconBadge } from "@/components/IconBadge";

const TABS = [
  {
    key: "fees",
    label: "Fee structures",
    icon: ClipboardList,
    title: "Set fees once, apply them everywhere",
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
    icon: Receipt,
    title: "Every student, invoiced correctly, every time",
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
    icon: CreditCard,
    title: "A dedicated bank account for every student",
    body: "Each student gets their own virtual bank account, provisioned through licensed payment infrastructure. Parents pay by transfer like they always have — the difference is what happens next.",
    points: [
      "Dedicated virtual account per student — no shared/ambiguous accounts",
      "Parents keep paying exactly how they already do — a bank transfer, no new app to install",
      "Payments matched to the right student and invoice automatically",
      "Funds settle to the school's own account — Fees101 never holds school funds",
    ],
  },
  {
    key: "notifications",
    label: "Notifications",
    icon: Bell,
    title: "Parents know before you have to chase them",
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
    icon: LayoutDashboard,
    title: "Built for one class — and for one thousand students",
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
    icon: Layers,
    title: "Batched by design, not by accident",
    body: "Bulk imports and account provisioning run in small chunks with progress feedback, specifically so onboarding a 300+ student school doesn't hit a server timeout. We load-tested this with a real 400-student import.",
  },
  {
    icon: ShieldCheck,
    title: "Safe to walk away from",
    body: "If an admin navigates away mid-import, the background work stops cleanly instead of silently continuing or corrupting data — a real bug we found and fixed during our own testing.",
  },
  {
    icon: Lock,
    title: "Credentials encrypted at rest",
    body: "Every school's own payment provider keys are stored encrypted (AES-256-GCM), never in plaintext, and never exposed to the browser.",
  },
  {
    icon: Plug,
    title: "Provider-agnostic by architecture",
    body: "Payment and messaging providers sit behind stable internal interfaces, so swapping or adding a provider later doesn't mean rewriting business logic.",
  },
  {
    icon: FlaskConical,
    title: "Tested before it costs money",
    body: "Our messaging pipeline has a full mock mode — every part of the compose-send-log flow is verified end to end before we spend a naira or need compliance sign-off to go live.",
  },
  {
    icon: Landmark,
    title: "Designed around Nigerian data law",
    body: "Data handling is built around the NDPA — schools stay the data controller for their students' information, and we act strictly as a processor on their instruction.",
  },
];

const INTEGRATIONS = [
  { icon: Wallet, name: "Monnify", note: "Payments" },
  { icon: MessageSquare, name: "Termii", note: "SMS & WhatsApp" },
];

export default function FeaturesPage() {
  const [active, setActive] = useState<(typeof TABS)[number]["key"]>("fees");
  const activeTab = TABS.find((t) => t.key === active)!;

  return (
    <>
      <section className="relative overflow-hidden bg-white px-6 pb-4 pt-16">
        <motion.div
          className="pointer-events-none absolute -right-40 -top-32 h-[420px] w-[420px] rounded-full bg-mint-light blur-3xl"
          animate={{ scale: [1, 1.08, 1], opacity: [0.6, 0.9, 0.6] }}
          transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
        />

        <div className="relative mx-auto grid max-w-6xl items-center gap-14 md:grid-cols-2">
          <Reveal className="text-center md:text-left">
            <span className="mb-3 inline-block text-xs font-bold uppercase tracking-wider text-mint-dark">
              Features
            </span>
            <h1 className="mx-auto mb-4 max-w-lg text-4xl font-bold leading-tight text-navy sm:text-5xl md:mx-0">
              Everything a school needs to run fees end to end
            </h1>
            <p className="mx-auto max-w-md text-base leading-relaxed text-gray-500 md:mx-0">
              Not a spreadsheet replacement — a full fee operations system, from
              setting the fee structure to knowing the money actually landed.
            </p>
          </Reveal>

          <Reveal delay={0.1} className="hidden justify-center md:flex">
            <div className="relative flex h-72 w-72 items-center justify-center">
              <motion.div
                className="absolute inset-0 rounded-full bg-mint-light/70"
                animate={{ scale: [1, 1.05, 1] }}
                transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.7, rotate: -8 }}
                animate={{ opacity: 1, scale: 1, rotate: 0 }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              >
                <Layers size={110} strokeWidth={1.4} className="text-mint-dark" />
              </motion.div>

              <motion.div
                initial={{ opacity: 0, scale: 0.6, x: 10 }}
                animate={{ opacity: 1, scale: 1, x: 0, y: [0, -6, 0] }}
                transition={{
                  opacity: { delay: 0.5, duration: 0.5 },
                  scale: { delay: 0.5, duration: 0.5 },
                  y: { delay: 1, duration: 3, repeat: Infinity, ease: "easeInOut" },
                }}
                className="absolute -right-2 top-6 flex items-center gap-2 rounded-xl border border-black/5 bg-white px-3 py-2 text-xs font-semibold text-navy shadow-lg"
              >
                <ClipboardList size={15} className="text-mint-dark" />
                Set up in minutes!
              </motion.div>

              <motion.div
                initial={{ opacity: 0, scale: 0.6, x: -10 }}
                animate={{ opacity: 1, scale: 1, x: 0, y: [0, 6, 0] }}
                transition={{
                  opacity: { delay: 0.7, duration: 0.5 },
                  scale: { delay: 0.7, duration: 0.5 },
                  y: { delay: 1.2, duration: 3.4, repeat: Infinity, ease: "easeInOut" },
                }}
                className="absolute -left-4 bottom-8 flex items-center gap-2 rounded-xl border border-black/5 bg-white px-3 py-2 text-xs font-semibold text-navy shadow-lg"
              >
                <LayoutDashboard size={15} className="text-mint-dark" />
                Scales with you
              </motion.div>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 py-14">
        <div className="mb-10 flex flex-wrap justify-center gap-2">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActive(tab.key)}
              className={`relative rounded-full px-4 py-2.5 text-sm font-semibold transition-colors ${
                active === tab.key ? "text-navy" : "text-gray-500 hover:text-navy"
              }`}
            >
              {active === tab.key && (
                <motion.span
                  layoutId="active-tab-pill"
                  className="absolute inset-0 rounded-full bg-mint-light"
                  transition={{ type: "spring", stiffness: 400, damping: 32 }}
                />
              )}
              <span className="relative flex items-center gap-1.5">
                <tab.icon size={15} strokeWidth={2.25} />
                {tab.label}
              </span>
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab.key}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="grid gap-10 rounded-3xl border border-black/5 bg-[#f6f9f8] p-8 sm:p-12 md:grid-cols-[1fr_1.1fr]"
          >
            <div className="flex flex-col justify-center">
              <motion.div
                key={activeTab.key}
                initial={{ scale: 0.6, rotate: -20, opacity: 0 }}
                animate={{ scale: 1, rotate: 0, opacity: 1 }}
                transition={{ type: "spring", stiffness: 260, damping: 18 }}
                className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-navy"
              >
                <activeTab.icon size={26} strokeWidth={2} color="#5ad8a6" />
              </motion.div>
              <h2 className="mb-3 text-2xl font-bold text-navy sm:text-3xl">
                {activeTab.title}
              </h2>
              <p className="text-[15px] leading-relaxed text-gray-500">{activeTab.body}</p>
            </div>
            <ul className="flex flex-col justify-center gap-4">
              {activeTab.points.map((point, i) => (
                <motion.li
                  key={point}
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.08 * i, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                  className="flex items-start gap-3 rounded-xl bg-white p-4 shadow-sm"
                >
                  <span className="mt-0.5 text-mint-dark">✓</span>
                  <span className="text-sm leading-relaxed text-gray-600">{point}</span>
                </motion.li>
              ))}
            </ul>
          </motion.div>
        </AnimatePresence>
      </section>

      <section className="border-t border-black/5 bg-[#f6f9f8] px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <Reveal className="mb-10 grid gap-3 md:grid-cols-[0.9fr_1.1fr] md:items-end">
            <div>
              <span className="mb-3 inline-block text-xs font-bold uppercase tracking-wider text-mint-dark">
                Under the hood
              </span>
              <h2 className="text-2xl font-bold text-navy sm:text-3xl">
                The hard-to-see decisions that make this work
              </h2>
            </div>
            <p className="text-sm leading-relaxed text-gray-500">
              Software for money and school records has to be boring in the
              right way. Here's some of the thinking behind it.
            </p>
          </Reveal>

          <RevealStagger className="grid divide-y divide-black/10 border-t border-black/10 md:grid-cols-2 md:divide-y-0 md:gap-x-10 md:border-t-0">
            {ENGINEERING.map((item, i) => (
              <RevealItem key={item.title}>
                <div
                  className={`flex items-start gap-4 py-5 ${
                    i % 2 === 0 ? "md:pr-10" : "md:pl-10"
                  } ${i >= 2 ? "md:border-t md:border-black/10" : ""}`}
                >
                  <span className="mt-0.5 shrink-0 font-mono text-xs font-semibold text-mint-dark">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <IconBadge icon={item.icon} size={34} className="shrink-0" />
                  <div>
                    <h3 className="mb-1 text-[15px] font-bold text-navy">{item.title}</h3>
                    <p className="text-[13px] leading-relaxed text-gray-500">{item.body}</p>
                  </div>
                </div>
              </RevealItem>
            ))}
          </RevealStagger>
        </div>
      </section>

      <section className="border-t border-black/5 bg-white px-6 py-10">
        <Reveal className="mx-auto max-w-6xl">
          <div className="grid gap-6 md:grid-cols-[1fr_1.3fr] md:items-center">
            <div>
              <span className="mb-1.5 inline-block text-xs font-bold uppercase tracking-wider text-mint-dark">
                Seamless integrations
              </span>
              <h2 className="mb-1.5 text-xl font-bold text-navy sm:text-2xl">
                Built to connect with what you already use
              </h2>
              <p className="text-sm leading-relaxed text-gray-500">
                We integrate with trusted payment and messaging providers to
                keep your workflow smooth and stress-free.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {INTEGRATIONS.map((i) => (
                <div
                  key={i.name}
                  className="flex items-center gap-3 rounded-xl border border-black/5 bg-[#f6f9f8] px-4 py-3"
                >
                  <i.icon size={18} strokeWidth={2} className="shrink-0 text-mint-dark" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-navy">{i.name}</div>
                    <div className="truncate text-xs text-gray-400">{i.note}</div>
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-center rounded-xl border border-dashed border-black/10 bg-[#f6f9f8]/60 px-4 py-3 text-center text-xs font-medium text-gray-400">
                More coming soon
              </div>
            </div>
          </div>
        </Reveal>
      </section>
    </>
  );
}
