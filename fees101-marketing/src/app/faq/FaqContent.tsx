"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Reveal } from "@/components/Reveal";
import { ClosingCta } from "@/components/ClosingCta";
import { FAQS } from "./faqData";

const CATEGORIES = [
  { key: "getting-started", label: "Getting started" },
  { key: "payments", label: "Payments & billing" },
  { key: "students", label: "Students & parents" },
  { key: "security", label: "Security" },
  { key: "account", label: "Account & company" },
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
      <section className="mx-auto max-w-6xl px-6 pb-8 pt-20">
        <div className="grid items-end gap-9 md:grid-cols-2">
          <Reveal>
            <span className="m-mono mb-4 block text-xs uppercase tracking-wider text-signal-text">
              FAQ
            </span>
            <h1 className="text-4xl font-extrabold leading-[0.92] tracking-tight text-ink sm:text-5xl md:text-6xl">
              Frequently asked{" "}
              <span className="text-signal-text">questions.</span>
            </h1>
          </Reveal>

          <Reveal delay={0.1}>
            <p className="mb-6 max-w-md text-base leading-relaxed text-neutral-700">
              Everything you need to know about Fees101. Can&apos;t find the
              answer you&apos;re looking for? Reach out and we&apos;ll help
              directly.
            </p>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the questions…"
              className="input"
            />
          </Reveal>
        </div>
      </section>

      {/* Category tabs */}
      <div className="sticky top-[69px] z-20 border-t-2 border-ink border-b border-neutral-300 bg-paper">
        <div className="mx-auto flex max-w-6xl flex-wrap gap-x-8 overflow-x-auto px-6">
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
                className={`shrink-0 border-b-2 py-4 text-[15px] transition-colors ${
                  active
                    ? "border-signal text-ink"
                    : "border-transparent text-neutral-700 hover:text-ink"
                }`}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Question list */}
      <section className="mx-auto max-w-[900px] px-6 py-14 sm:py-16">
        {searching && (
          <p className="mb-5 text-[15px] text-neutral-700">
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
          >
            {visible.length === 0 && (
              <p className="border-t border-neutral-300 py-6 text-[15px] text-neutral-700">
                No questions match that search — try another term or email
                support@fees101.com directly.
              </p>
            )}
            {visible.map((item) => {
              const open = openQ === item.q;
              return (
                <div key={item.q} className="border-t border-neutral-300">
                  <button
                    onClick={() => setOpenQ(open ? null : item.q)}
                    className="flex w-full cursor-pointer items-baseline justify-between gap-6 py-6 text-left"
                  >
                    <span className="text-2xl font-semibold leading-tight text-ink sm:text-3xl">
                      {item.q}
                    </span>
                    <motion.span
                      animate={{ rotate: open ? 45 : 0 }}
                      transition={{ duration: 0.25 }}
                      className="shrink-0 text-2xl leading-none text-signal-text"
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
                        <p className="max-w-[38em] pb-7 text-[15px] leading-relaxed text-neutral-700">
                          {item.a}
                        </p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
            <div className="border-t border-neutral-300" />
          </motion.div>
        </AnimatePresence>
      </section>

      <ClosingCta
        head="Still have questions?"
        body="Our team reads every message directly — no ticketing bot in between."
      />
    </>
  );
}
