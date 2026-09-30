import type { ReactNode } from "react";

export function LegalLayout({
  title,
  updated,
  sections,
  children,
}: {
  title: string;
  updated: string;
  sections: { id: string; label: string }[];
  children: ReactNode;
}) {
  return (
    <article className="bg-paper px-6 py-16">
      <header className="mx-auto mb-10 max-w-5xl">
        <span className="mb-3 inline-block text-xs font-bold uppercase tracking-wider text-signal">
          Legal &middot; Last updated {updated}
        </span>
        <h1 className="text-3xl font-bold leading-tight text-ink sm:text-5xl">{title}</h1>
      </header>
      <hr className="m-rule mx-auto max-w-5xl" />
      <div className="mx-auto grid max-w-5xl gap-10 pt-10 md:grid-cols-[200px_1fr]">
        <nav className="hidden md:block">
          <div className="sticky top-24">
            <div className="mb-3 text-xs font-bold uppercase tracking-widest text-neutral-500">
              Contents
            </div>
            <ul className="flex flex-col gap-2.5 border-l-2 border-neutral-300 text-[13px]">
              {sections.map((s) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className="-ml-px block border-l-2 border-transparent py-0.5 pl-3 text-neutral-600 transition-colors hover:border-ink hover:text-ink"
                  >
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </nav>
        <div className="prose-legal flex max-w-3xl flex-col gap-8 text-[15px] leading-relaxed text-neutral-700">
          {children}
        </div>
      </div>
    </article>
  );
}

export function LegalSection({
  id,
  heading,
  children,
}: {
  id: string;
  heading: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20">
      <h2 className="mb-3 text-lg font-bold text-ink">{heading}</h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}
