"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { LogoHorizontal } from "./Logo";

const NAV_LINKS = [
  { href: "/", label: "Home", num: "00" },
  { href: "/features", label: "Platform", num: "01" },
  { href: "/how-it-works", label: "How it works", num: "02" },
  { href: "/pricing", label: "Pricing", num: "03" },
  { href: "/about", label: "About", num: "04" },
  { href: "/faq", label: "FAQ", num: "05" },
] as const;

export function Header() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 border-b-2 border-ink bg-paper">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="shrink-0" onClick={() => setOpen(false)}>
          <LogoHorizontal height={22} />
        </Link>

        <nav className="hidden items-center gap-7 text-sm font-semibold text-neutral-700 md:flex">
          {NAV_LINKS.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`relative flex items-baseline gap-1.5 py-1 transition-colors hover:text-ink ${
                  active ? "text-ink" : ""
                }`}
              >
                <span className="m-mono text-[10px] font-normal text-neutral-400">
                  {link.num}
                </span>
                {link.label}
                {active && (
                  <motion.span
                    layoutId="nav-underline"
                    className="absolute -bottom-[17px] left-0 right-0 h-[2px] bg-signal"
                    transition={{ type: "spring", stiffness: 400, damping: 32 }}
                  />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="hidden md:block">
          <Link href="/request-access" className="m-btn m-btn-primary">
            Request access
          </Link>
        </div>

        <button
          aria-label="Toggle menu"
          onClick={() => setOpen((v) => !v)}
          className="flex h-9 w-9 flex-col items-center justify-center gap-1.5 md:hidden"
        >
          <span
            className={`h-0.5 w-6 bg-ink transition-transform ${
              open ? "translate-y-2 rotate-45" : ""
            }`}
          />
          <span className={`h-0.5 w-6 bg-ink transition-opacity ${open ? "opacity-0" : ""}`} />
          <span
            className={`h-0.5 w-6 bg-ink transition-transform ${
              open ? "-translate-y-2 -rotate-45" : ""
            }`}
          />
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <motion.nav
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="flex flex-col gap-1 overflow-hidden border-t-2 border-ink bg-paper px-6 md:hidden"
          >
            <div className="flex flex-col gap-1 py-4">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className={`flex items-baseline gap-2.5 px-3 py-2.5 text-sm font-semibold ${
                    pathname === link.href
                      ? "bg-ink text-paper"
                      : "text-neutral-700 hover:bg-neutral-200"
                  }`}
                >
                  <span
                    className={`m-mono text-[10px] font-normal ${
                      pathname === link.href ? "text-neutral-400" : "text-neutral-500"
                    }`}
                  >
                    {link.num}
                  </span>
                  {link.label}
                </Link>
              ))}
              <Link
                href="/request-access"
                onClick={() => setOpen(false)}
                className="m-btn m-btn-primary mt-2 justify-center"
              >
                Request access
              </Link>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}
