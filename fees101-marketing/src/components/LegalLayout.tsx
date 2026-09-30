import type { ReactNode } from "react";

export function LegalLayout({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <article className="mx-auto max-w-3xl px-6 py-16">
      <header className="mb-10 border-b border-black/10 pb-8">
        <h1 className="mb-2 text-3xl font-bold text-navy sm:text-4xl">{title}</h1>
        <p className="text-sm text-gray-500">Last updated: {updated}</p>
      </header>
      <div className="prose-legal flex flex-col gap-8 text-[15px] leading-relaxed text-gray-700">
        {children}
      </div>
    </article>
  );
}

export function LegalSection({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-3 text-lg font-bold text-navy">{heading}</h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}
