import type { ReactNode } from "react";

export function TerminalPanel({
  label,
  children,
  className = "",
  tone = "light",
}: {
  label: string;
  children: ReactNode;
  className?: string;
  tone?: "light" | "dark";
}) {
  const dark = tone === "dark";
  return (
    <div
      className={`overflow-hidden border-2 border-ink ${dark ? "bg-ink" : "bg-paper"} ${className}`}
    >
      <div
        className={`flex items-center gap-1.5 border-b-2 px-4 py-3 ${
          dark ? "border-neutral-700 bg-neutral-900" : "border-ink bg-surface"
        }`}
      >
        <span className={`h-2.5 w-2.5 border ${dark ? "border-neutral-600" : "border-ink"}`} />
        <span className={`h-2.5 w-2.5 border ${dark ? "border-neutral-600" : "border-ink"}`} />
        <span className={`h-2.5 w-2.5 border ${dark ? "border-neutral-600" : "border-ink"}`} />
        <span
          className={`ml-2 font-mono text-xs ${dark ? "text-neutral-500" : "text-neutral-600"}`}
        >
          {label}
        </span>
      </div>
      <div className={`p-5 ${dark ? "m-grid-paper-ink" : "m-grid-paper"}`}>{children}</div>
    </div>
  );
}
