"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Bell,
  BadgeCheck,
  CheckCircle2,
  ClipboardList,
  Clock,
  LayoutDashboard,
  Receipt,
  Rocket,
  ShieldCheck,
  UserPlus,
  Users,
  XCircle,
} from "lucide-react";
import { Reveal, RevealStagger, RevealItem } from "@/components/Reveal";
import { Counter } from "@/components/Counter";
import { IconBadge } from "@/components/IconBadge";
import { TiltCard } from "@/components/TiltCard";
import { HeroPreview } from "@/components/HeroPreview";
import { AfricaSection } from "@/components/AfricaSection";

const HIGHLIGHTS = [
  {
    icon: ClipboardList,
    title: "Fee structures per term/class",
    body: "Set tuition and levies once per class and term, applied consistently to every student in it.",
  },
  {
    icon: Receipt,
    title: "Per-student invoicing",
    body: "Automatic invoices with any outstanding balance carried forward to the next term.",
  },
  {
    icon: BadgeCheck,
    title: "Automated reconciliation",
    body: "Payments are matched to the right student and invoice the moment they land — no manual chasing.",
  },
  {
    icon: LayoutDashboard,
    title: "Collection dashboard",
    body: "A live view of what's collected, what's outstanding, and who needs a nudge.",
  },
  {
    icon: Bell,
    title: "SMS + WhatsApp reminders",
    body: "Parents get notified the moment an invoice goes out or a payment is confirmed.",
  },
  {
    icon: UserPlus,
    title: "Bulk student onboarding",
    body: "Import an entire school's student list from a CSV in minutes, not one form at a time.",
  },
];

const STATS = [
  {
    icon: Users,
    to: 400,
    suffix: "+",
    label: "students onboarded in a single import during load testing",
  },
  {
    icon: Clock,
    to: 90,
    suffix: "s",
    label: "for that entire 400-student batch to fully provision",
  },
  {
    icon: BadgeCheck,
    to: 100,
    suffix: "%",
    label: "of student payments auto-reconciled — no spreadsheets",
  },
];

const MARQUEE = [
  "Dedicated virtual accounts",
  "Automated reconciliation",
  "Bulk CSV onboarding",
  "AES-256 encrypted credentials",
  "SMS + WhatsApp notifications",
  "Provider-agnostic architecture",
  "Live collection dashboard",
];

const PAIN_POINTS = [
  {
    before: "Payments confirmed by screenshot and WhatsApp messages",
    after: "Every payment auto-matched to the right student the moment it lands",
  },
  {
    before: "No one knows who's paid until someone checks manually",
    after: "A live dashboard shows exactly who's paid and who's outstanding",
  },
  {
    before: "Reminding parents means calling or texting one by one",
    after: "Automatic SMS + WhatsApp reminders for every unpaid invoice",
  },
  {
    before: "Fee structures re-entered by hand for every student",
    after: "Set it once per class — every student inherits it automatically",
  },
  {
    before: "Spreadsheets that fall out of sync between staff",
    after: "One system, one source of truth, updated in real time",
  },
];

export default function HomePage() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden bg-white px-6 pb-24 pt-20">
        <motion.div
          className="pointer-events-none absolute -left-40 -top-40 h-[480px] w-[480px] rounded-full bg-mint-light blur-3xl"
          animate={{ scale: [1, 1.08, 1], opacity: [0.5, 0.85, 0.5] }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="pointer-events-none absolute -right-32 top-10 h-[360px] w-[360px] rounded-full bg-[#eaf3ff] blur-3xl"
          animate={{ scale: [1, 1.1, 1], opacity: [0.4, 0.7, 0.4] }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 1 }}
        />

        <div className="relative mx-auto grid max-w-6xl items-center gap-14 md:grid-cols-[1fr_1.3fr]">
          <div className="text-center md:text-left">
            <motion.span
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15, duration: 0.5 }}
              className="mb-6 inline-flex items-center gap-2 rounded-full border border-mint-dark/25 bg-mint-light px-4 py-2 text-[13px] font-semibold uppercase tracking-wider text-mint-dark"
            >
              <Rocket size={14} />
              School Fee Management System
            </motion.span>

            <motion.h1
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25, duration: 0.6 }}
              className="mb-4 max-w-lg text-3xl font-bold leading-tight text-navy sm:text-4xl md:mx-0"
            >
              The smarter way to manage school{" "}
              <span className="text-mint-dark">fees</span>.
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35, duration: 0.6 }}
              className="mx-auto mb-8 max-w-xl text-lg leading-relaxed text-gray-500 md:mx-0"
            >
              Fees101 is school fee management software for Nigerian schools —
              invoicing, payment tracking and automated reconciliation, built
              with the same care as the schools we're building it for.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.45, duration: 0.6 }}
              className="flex flex-wrap justify-center gap-3 md:justify-start"
            >
              <a
                href="mailto:support@fees101.com"
                className="rounded-xl bg-navy px-6 py-3 text-sm font-semibold text-white transition-transform hover:-translate-y-0.5"
              >
                Talk to us
              </a>
              <Link
                href="/how-it-works"
                className="rounded-xl border border-black/10 bg-white px-6 py-3 text-sm font-semibold text-navy transition-transform hover:-translate-y-0.5"
              >
                See how it works
              </Link>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.55, duration: 0.6 }}
              className="mt-6 flex items-center justify-center gap-2 text-sm text-gray-400 md:justify-start"
            >
              <ShieldCheck size={15} className="text-mint-dark" />
              Secure. Reliable. Built for schools.
            </motion.div>
          </div>

          <HeroPreview />
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6, duration: 0.6 }}
          className="relative mt-16 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]"
        >
          <motion.div
            className="flex w-max gap-10 text-sm font-semibold uppercase tracking-wider text-gray-300"
            animate={{ x: ["0%", "-50%"] }}
            transition={{ duration: 22, repeat: Infinity, ease: "linear" }}
          >
            {[...MARQUEE, ...MARQUEE].map((item, i) => (
              <span key={i} className="flex items-center gap-2 whitespace-nowrap">
                <span className="h-1.5 w-1.5 rounded-full bg-mint-dark" />
                {item}
              </span>
            ))}
          </motion.div>
        </motion.div>
      </section>

      {/* Pain points */}
      <section className="bg-[#f6f9f8] px-6 py-20">
        <div className="mx-auto max-w-4xl">
          <Reveal className="mb-12 text-center">
            <span className="mb-3 inline-block text-xs font-bold uppercase tracking-wider text-mint-dark">
              Sound familiar?
            </span>
            <h2 className="mx-auto max-w-xl text-3xl font-bold text-navy sm:text-4xl">
              Fee collection shouldn&apos;t be this hard
            </h2>
          </Reveal>

          <RevealStagger className="flex flex-col gap-3">
            {PAIN_POINTS.map((p) => (
              <RevealItem key={p.before}>
                <div className="grid items-center gap-3 rounded-2xl border border-black/5 bg-white p-5 shadow-sm sm:grid-cols-[1fr_auto_1fr] sm:gap-6 sm:p-6">
                  <div className="flex items-start gap-3">
                    <XCircle size={18} className="mt-0.5 shrink-0 text-red-300" />
                    <p className="text-sm leading-relaxed text-gray-400 line-through decoration-gray-300">
                      {p.before}
                    </p>
                  </div>
                  <ArrowRight
                    size={16}
                    className="hidden shrink-0 rotate-90 text-gray-300 sm:block sm:rotate-0"
                  />
                  <div className="flex items-start gap-3">
                    <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-mint-dark" />
                    <p className="text-sm font-medium leading-relaxed text-navy">
                      {p.after}
                    </p>
                  </div>
                </div>
              </RevealItem>
            ))}
          </RevealStagger>
        </div>
      </section>

      {/* Highlights */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="grid items-center gap-12 md:grid-cols-[1fr_1.4fr]">
          <Reveal>
            <span className="mb-3 inline-block text-xs font-bold uppercase tracking-wider text-mint-dark">
              What we do
            </span>
            <h2 className="mb-3 text-3xl font-bold text-navy sm:text-4xl">
              Everything your school needs to manage fees
            </h2>
            <p className="mb-7 max-w-sm text-base leading-relaxed text-gray-500">
              One platform to set fees, invoice families, track every
              payment, and know exactly where collections stand.
            </p>
            <Link
              href="/features"
              className="inline-flex items-center gap-1.5 rounded-xl bg-mint-dark px-5 py-3 text-sm font-semibold text-white transition-transform hover:-translate-y-0.5"
            >
              Explore all features <ArrowRight size={15} />
            </Link>
          </Reveal>

          <Reveal delay={0.1}>
            <motion.img
              src="/images/fee-management-illustration.png"
              alt="Fees101 payment confirmation illustration"
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              className="w-full"
            />
          </Reveal>
        </div>

        <RevealStagger className="mt-16 grid grid-cols-1 gap-4 sm:grid-cols-3 md:grid-cols-6">
          {HIGHLIGHTS.map((f) => (
            <RevealItem key={f.title}>
              <TiltCard className="flex h-full flex-col items-center gap-3 rounded-2xl border border-black/5 bg-[#f6f9f8] px-4 py-6 text-center hover:shadow-xl hover:shadow-mint-light">
                <IconBadge icon={f.icon} />
                <h3 className="text-[13px] font-bold leading-snug text-navy">
                  {f.title}
                </h3>
              </TiltCard>
            </RevealItem>
          ))}
        </RevealStagger>
      </section>

      <AfricaSection />

      {/* Real numbers from real testing */}
      <section className="bg-white px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <Reveal className="mb-14 max-w-xl">
            <span className="mb-3 inline-block text-xs font-bold uppercase tracking-wider text-mint-dark">
              Built, not just designed
            </span>
            <h2 className="text-3xl font-bold text-navy sm:text-4xl">
              We stress-test this before a school ever sees it
            </h2>
          </Reveal>

          <div className="grid gap-6 sm:grid-cols-3">
            {STATS.map((s, i) => (
              <Reveal
                key={s.label}
                className={`rounded-2xl border border-black/5 bg-[#f6f9f8] p-8 shadow-sm ${
                  i === 1 ? "sm:-translate-y-5" : ""
                }`}
              >
                <IconBadge icon={s.icon} tone="light" className="mb-5 bg-navy" size={44} />
                <div className="text-4xl font-bold text-navy sm:text-5xl">
                  <Counter to={s.to} suffix={s.suffix} />
                </div>
                <p className="mt-3 max-w-[220px] text-sm leading-relaxed text-gray-500">
                  {s.label}
                </p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="border-t border-black/5 bg-[#f6f9f8] px-6 py-16">
        <div className="mx-auto max-w-6xl">
          <div className="grid items-center gap-8 md:grid-cols-[1.3fr_1fr]">
            <Reveal>
              <h2 className="mb-3 text-2xl font-bold text-navy sm:text-3xl">
                We&apos;re building Fees101 right now
              </h2>
              <p className="max-w-lg text-[15px] leading-relaxed text-gray-500">
                If you run a school in Nigeria and want early access, reach
                out — we&apos;d love to hear from you.
              </p>
            </Reveal>

            <Reveal className="flex md:justify-end">
              <a
                href="mailto:support@fees101.com"
                className="inline-block whitespace-nowrap rounded-xl bg-navy px-7 py-3.5 text-sm font-semibold text-white transition-transform hover:-translate-y-0.5"
              >
                support@fees101.com
              </a>
            </Reveal>
          </div>

          <div className="mt-10 grid gap-6 border-t border-black/10 pt-8 sm:grid-cols-3">
            {[
              { title: "No spam", body: "Just a launch note" },
              { title: "Early access", body: "Be first to try it" },
              { title: "Direct line", body: "Straight to our team" },
            ].map((item) => (
              <Reveal key={item.title} className="flex items-start gap-3">
                <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-mint-dark" />
                <div>
                  <div className="text-sm font-semibold text-navy">{item.title}</div>
                  <div className="text-xs text-gray-400">{item.body}</div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
