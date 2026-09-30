"use client";

import { Reveal, RevealStagger, RevealItem } from "@/components/Reveal";

const STORY = [
  {
    tag: "The problem",
    title: "Revenue ran on memory",
    body: "Notebooks, WhatsApp messages, and bank alerts nobody can match to a student — it works, until a school passes a hundred students.",
  },
  {
    tag: "The approach",
    title: "Make it boring, on purpose",
    body: "Set the fee structure once, invoice every student automatically, let each family pay into their own account, and watch it reconcile itself.",
  },
  {
    tag: "The build",
    title: "Tested before it matters",
    body: "Every provider — payments, messaging — sits behind an interface we control, tested at real scale before a single school depends on it.",
  },
];

export function StoryTimeline() {
  return (
    <>
      <section className="bg-paper px-6 py-16 sm:py-20">
        <div className="mx-auto max-w-6xl">
          <Reveal className="mb-12">
            <span className="m-mono mb-4 block text-xs uppercase tracking-wider text-signal-text">
              Our story
            </span>
            <h2 className="max-w-xl text-3xl font-extrabold leading-tight text-ink sm:text-4xl">
              Built out of a real problem, not a hunch.
            </h2>
          </Reveal>

          <RevealStagger className="grid grid-cols-1 border-t-2 border-ink sm:grid-cols-3">
            {STORY.map((s, i) => (
              <RevealItem
                key={s.tag}
                className={`py-8 pr-0 sm:pr-10 ${
                  i > 0 ? "border-t border-neutral-300 sm:border-t-0" : ""
                } ${i < STORY.length - 1 ? "sm:border-r sm:border-neutral-300" : ""}`}
              >
                <div className="mb-3 font-heading text-6xl font-normal leading-none text-signal">
                  0{i + 1}
                </div>
                <span className="m-mono mb-2 block text-[11px] uppercase tracking-wider text-signal-text">
                  {s.tag}
                </span>
                <h3 className="mb-2.5 text-xl font-semibold text-ink">{s.title}</h3>
                <p className="text-[15px] leading-relaxed text-neutral-700">{s.body}</p>
              </RevealItem>
            ))}
          </RevealStagger>
        </div>
      </section>

      <section className="border-t-2 border-ink bg-ink px-6 py-20 sm:py-28">
        <Reveal className="mx-auto max-w-[1000px]">
          <div className="mb-2 font-heading text-8xl leading-none text-[#5ad8a6]">
            &ldquo;
          </div>
          <p className="max-w-3xl text-[clamp(27px,4vw,54px)] font-normal leading-[1.15] text-paper">
            A school shouldn&apos;t need a spreadsheet expert to know who has
            paid this term.
          </p>
          <span className="m-mono mt-8 block text-xs uppercase tracking-wider text-[#5ad8a6]">
            Why Fees101 exists
          </span>
        </Reveal>
      </section>
    </>
  );
}
