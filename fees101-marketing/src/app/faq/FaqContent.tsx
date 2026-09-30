"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Rocket,
  CreditCard,
  Users,
  ShieldCheck,
  Settings,
  MessageCircle,
  CheckCircle2,
  Headset,
} from "lucide-react";
import { Reveal } from "@/components/Reveal";
import { IconBadge } from "@/components/IconBadge";

const CATEGORIES = [
  { key: "getting-started", label: "Getting Started", icon: Rocket },
  { key: "payments", label: "Payments & Billing", icon: CreditCard },
  { key: "students", label: "Students & Parents", icon: Users },
  { key: "security", label: "Security", icon: ShieldCheck },
  { key: "account", label: "Account & Company", icon: Settings },
];

const FAQS = [
  {
    category: "getting-started",
    q: "What is Fees101?",
    a: "Fees101 is school fee management software for Nigerian schools. It helps schools set up fee structures per term/class, generate per-student invoices, collect payments, and automatically reconcile them against the right student.",
  },
  {
    category: "getting-started",
    q: "Is Fees101 live yet?",
    a: "Fees101 is in active development and currently being rolled out with a small number of schools. We're not yet open for general sign-up, but we'd love to hear from schools interested in early access.",
  },
  {
    category: "getting-started",
    q: "How can my school get early access?",
    a: "Reach out to support@fees101.com and we'll get you set up as part of our early onboarding.",
  },
  {
    category: "payments",
    q: "How does payment collection work?",
    a: "Each student is issued a dedicated virtual bank account through our licensed payment infrastructure partner. Parents pay directly into that account, and Fees101 automatically matches the payment to the right student and invoice — no manual reconciliation needed.",
  },
  {
    category: "payments",
    q: "Do parents need to download an app or change how they pay?",
    a: "No. Parents keep paying exactly how they already do — a regular bank transfer, from whatever banking app they normally use. The only difference is they're transferring into their own child's dedicated account instead of a shared one, and it's the school's side that's now organised — everything is matched and recorded automatically.",
  },
  {
    category: "payments",
    q: "Does Fees101 hold our money?",
    a: "No. Fees101 does not hold school funds. Payments are settled through our payment infrastructure partner directly to the school's own designated settlement account.",
  },
  {
    category: "payments",
    q: "What happens to a student's outstanding balance at the end of term?",
    a: "Any unpaid balance is automatically carried forward to the student's next invoice, so nothing gets lost between terms.",
  },
  {
    category: "students",
    q: "How do parents get notified about fees?",
    a: "Parents receive SMS (and in future, WhatsApp) notifications for new invoices and payment confirmations, sent through our licensed messaging provider, using the phone number the school has on file.",
  },
  {
    category: "students",
    q: "Does Fees101 send anything other than fee-related messages?",
    a: "No. Every SMS/WhatsApp notification we send is tied to a specific invoice, payment, or reminder for that student's fees — never marketing or unrelated messages.",
  },
  {
    category: "security",
    q: "How is our data protected?",
    a: "We apply industry-standard security practices, including encrypted connections and encrypted storage of sensitive credentials. See our Privacy Policy for full detail on what we collect and how it's used.",
  },
  {
    category: "account",
    q: "Is Fees101 a registered company?",
    a: "Yes. Fees101 is operated by FEES101 LTD, RC 9694725, registered in Nigeria with its registered office at Plot L182, Ellicot Citi Street, Kubwa Extension III, Bwari, FCT, Nigeria.",
  },
  {
    category: "account",
    q: "Who can I contact for support or questions?",
    a: "General enquiries: support@fees101.com. Support: support@fees101.com. Both inboxes are checked directly by our team — there's no ticketing bot in between.",
  },
];

export function FaqContent() {
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState(CATEGORIES[0].key);
  const [openQ, setOpenQ] = useState<string | null>(FAQS[0].q);

  const searching = query.trim().length > 0;

  const visible = useMemo(() => {
    if (searching) {
      const q = query.toLowerCase();
      return FAQS.filter(
        (f) => f.q.toLowerCase().includes(q) || f.a.toLowerCase().includes(q)
      );
    }
    return FAQS.filter((f) => f.category === activeCategory);
  }, [query, activeCategory, searching]);

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden bg-white px-6 pb-16 pt-16">
        <motion.div
          className="pointer-events-none absolute -right-40 -top-32 h-[420px] w-[420px] rounded-full bg-mint-light blur-3xl"
          animate={{ scale: [1, 1.08, 1], opacity: [0.6, 0.9, 0.6] }}
          transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
        />

        <div className="relative mx-auto grid max-w-6xl items-center gap-14 md:grid-cols-2">
          <Reveal>
            <span className="mb-3 inline-block text-xs font-bold uppercase tracking-wider text-mint-dark">
              FAQ
            </span>
            <h1 className="mb-4 text-4xl font-bold leading-tight text-navy sm:text-5xl">
              Frequently asked
              <br />
              <span className="text-mint-dark">questions</span>
            </h1>
            <p className="mb-7 max-w-md text-base leading-relaxed text-gray-500">
              Everything you need to know about Fees101. Can&apos;t find the
              answer you&apos;re looking for? Reach out and we&apos;ll help
              directly.
            </p>

            <div className="flex max-w-md items-center gap-3 rounded-xl border border-black/10 bg-[#f6f9f8] px-4 py-3">
              <Search size={17} className="shrink-0 text-gray-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search questions…"
                className="w-full bg-transparent text-sm text-navy outline-none placeholder:text-gray-400"
              />
            </div>
          </Reveal>

          <Reveal delay={0.1} className="hidden justify-center md:flex">
            <div className="relative flex h-72 w-72 items-center justify-center">
              <motion.div
                className="absolute inset-0 rounded-full bg-mint-light/70"
                animate={{ scale: [1, 1.05, 1] }}
                transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
              />
              <motion.img
                src="/images/faq-hero.png"
                alt="Fees101 invoice with a question mark and chat bubbles"
                initial={{ opacity: 0, scale: 0.7, rotate: -8 }}
                animate={{ opacity: 1, scale: 1, rotate: 0 }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                className="relative w-64"
              />

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
                <MessageCircle size={15} className="text-mint-dark" />
                Ask us anything
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
                <CheckCircle2 size={15} className="text-mint-dark" />
                Clear answers
              </motion.div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Category tabs */}
      <div className="sticky top-0 z-20 border-y border-black/5 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl justify-center gap-1 overflow-x-auto px-6">
          {CATEGORIES.map((c) => {
            const active = !searching && activeCategory === c.key;
            return (
              <button
                key={c.key}
                onClick={() => {
                  setQuery("");
                  setActiveCategory(c.key);
                  setOpenQ(null);
                }}
                className="relative flex shrink-0 flex-col items-center gap-2 px-5 py-4 text-sm font-medium text-gray-400 transition-colors hover:text-navy"
              >
                <c.icon
                  size={18}
                  className={active ? "text-mint-dark" : "text-gray-300"}
                />
                <span className={active ? "font-semibold text-navy" : ""}>
                  {c.label}
                </span>
                {active && (
                  <motion.span
                    layoutId="faq-tab-underline"
                    className="absolute -bottom-px left-0 right-0 h-[2px] bg-mint-dark"
                    transition={{ type: "spring", stiffness: 400, damping: 32 }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Question list */}
      <section className="mx-auto max-w-3xl px-6 py-14">
        {searching && (
          <p className="mb-5 text-sm text-gray-500">
            {visible.length} result{visible.length === 1 ? "" : "s"} for
            &ldquo;{query}&rdquo;
          </p>
        )}

        <AnimatePresence mode="wait">
          <motion.div
            key={searching ? `search-${query}` : activeCategory}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
            className="flex flex-col gap-3"
          >
            {visible.length === 0 && (
              <p className="rounded-xl border border-black/5 bg-[#f6f9f8] px-5 py-6 text-center text-sm text-gray-500">
                No questions match that search — try another term or email
                support@fees101.com directly.
              </p>
            )}
            {visible.map((item) => {
              const open = openQ === item.q;
              return (
                <div
                  key={item.q}
                  className={`rounded-xl border border-black/10 px-5 py-4 transition-colors ${
                    open ? "bg-white shadow-sm" : "bg-[#f6f9f8]"
                  }`}
                >
                  <button
                    onClick={() => setOpenQ(open ? null : item.q)}
                    className="flex w-full cursor-pointer items-center justify-between gap-4 text-left font-semibold text-navy"
                  >
                    {item.q}
                    <motion.span
                      animate={{ rotate: open ? 45 : 0 }}
                      transition={{ duration: 0.25 }}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-mint-light text-mint-dark"
                    >
                      +
                    </motion.span>
                  </button>
                  <AnimatePresence initial={false}>
                    {open && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                        className="overflow-hidden"
                      >
                        <p className="mt-3 text-sm leading-relaxed text-gray-600">
                          {item.a}
                        </p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </motion.div>
        </AnimatePresence>
      </section>

      {/* Still have questions CTA */}
      <section className="border-t border-black/5 bg-white px-6 py-10">
        <Reveal className="mx-auto flex max-w-6xl flex-col items-center gap-6 text-center sm:flex-row sm:text-left">
          <IconBadge icon={Headset} size={56} />
          <div className="flex-1">
            <h2 className="mb-1 text-xl font-bold text-navy">
              Still have questions?
            </h2>
            <p className="text-sm text-gray-600">
              Our team reads every message directly — no ticketing bot in
              between.
            </p>
          </div>
          <a
            href="mailto:support@fees101.com"
            className="shrink-0 rounded-xl bg-navy px-6 py-3 text-sm font-semibold text-white transition-transform hover:-translate-y-0.5"
          >
            support@fees101.com
          </a>
        </Reveal>
      </section>
    </>
  );
}
