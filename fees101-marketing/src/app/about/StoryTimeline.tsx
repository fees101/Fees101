"use client";

import { Fragment } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, ArrowDown, ArrowRight, Hammer, Quote, Target } from "lucide-react";
import { Reveal, RevealStagger, RevealItem } from "@/components/Reveal";
import { IconBadge } from "@/components/IconBadge";
import { TiltCard } from "@/components/TiltCard";

const STORY = [
  {
    icon: AlertTriangle,
    tag: "The problem",
    title: "Fee collection ran on memory",
    body: "Notebooks, WhatsApp messages, and bank alerts nobody can match to a student — it works, until a school passes a hundred students.",
  },
  {
    icon: Target,
    tag: "The approach",
    title: "Make it boring, on purpose",
    body: "Set the fee structure once, invoice every student automatically, let each family pay into their own account, and watch it reconcile itself.",
  },
  {
    icon: Hammer,
    tag: "The build",
    title: "Tested before it matters",
    body: "Every provider — payments, messaging — sits behind an interface we control, tested at real scale before a single school depends on it.",
  },
];

export function StoryTimeline() {
  return (
    <section className="bg-white px-6 py-16">
      <div className="mx-auto max-w-5xl">
        <Reveal className="mx-auto mb-12 max-w-xl text-center">
          <span className="mb-3 inline-block text-xs font-bold uppercase tracking-wider text-mint-dark">
            Our story
          </span>
          <h2 className="text-3xl font-bold text-navy sm:text-4xl">
            Built out of a real problem, not a hunch
          </h2>
        </Reveal>

        <RevealStagger className="flex flex-col items-stretch gap-3 md:flex-row">
          {STORY.map((s, i) => (
            <Fragment key={s.tag}>
              <RevealItem className="flex-1">
                <TiltCard className="relative h-full rounded-2xl border border-black/5 bg-white p-6 shadow-sm">
                  <span className="absolute right-5 top-5 font-mono text-xs font-semibold text-gray-300">
                    0{i + 1}
                  </span>
                  <IconBadge icon={s.icon} size={44} className="mb-4" />
                  <span className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-mint-dark">
                    {s.tag}
                  </span>
                  <h3 className="mb-2 text-lg font-bold text-navy">{s.title}</h3>
                  <p className="text-sm leading-relaxed text-gray-500">{s.body}</p>
                </TiltCard>
              </RevealItem>

              {i < STORY.length - 1 && (
                <div className="flex items-center justify-center text-gray-300">
                  <ArrowDown size={18} className="md:hidden" />
                  <ArrowRight size={18} className="hidden md:block" />
                </div>
              )}
            </Fragment>
          ))}
        </RevealStagger>
      </div>

      <Reveal delay={0.3}>
        <motion.blockquote className="relative mx-auto mt-12 max-w-3xl rounded-2xl bg-navy px-8 py-10 text-center sm:px-14">
          <Quote
            size={32}
            strokeWidth={1.5}
            className="mx-auto mb-4 text-mint"
            fill="currentColor"
            fillOpacity={0.15}
          />
          <p className="mx-auto max-w-xl text-lg font-semibold leading-relaxed text-white sm:text-xl">
            "A school shouldn't need a spreadsheet expert to know who has
            paid this term."
          </p>
          <footer className="mt-4 text-sm font-medium text-mint">
            — Why Fees101 exists
          </footer>
        </motion.blockquote>
      </Reveal>
    </section>
  );
}
