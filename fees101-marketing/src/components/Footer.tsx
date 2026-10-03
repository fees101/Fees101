import Link from "next/link";
import { LogoHorizontal } from "./Logo";

const PRODUCT_LINKS = [
  { href: "/features", label: "Platform" },
  { href: "/why-fees101", label: "Why Fees101" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
  { href: "/about", label: "About" },
  { href: "/faq", label: "FAQ" },
];

const LEGAL_LINKS = [
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms of Service" },
];

export function Footer() {
  return (
    <footer className="border-t-2 border-ink bg-ink px-6 pb-6 pt-12 text-neutral-300">
      <div className="mx-auto grid max-w-6xl gap-10 pb-8 md:grid-cols-[1fr_1fr_1fr_1.2fr]">
        <div>
          <LogoHorizontal height={20} variant="invert" />
          <p className="mt-3 max-w-xs text-sm leading-relaxed text-neutral-400">
            Revenue operations platform for Nigerian schools.
          </p>
        </div>

        <div>
          <h4 className="mb-3 text-xs font-bold uppercase tracking-widest text-neutral-500">
            Product
          </h4>
          <div className="flex flex-col gap-2 text-sm">
            {PRODUCT_LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="transition-colors hover:text-paper">
                {l.label}
              </Link>
            ))}
          </div>
        </div>

        <div>
          <h4 className="mb-3 text-xs font-bold uppercase tracking-widest text-neutral-500">
            Legal
          </h4>
          <div className="flex flex-col gap-2 text-sm">
            {LEGAL_LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="transition-colors hover:text-paper">
                {l.label}
              </Link>
            ))}
          </div>
          <h4 className="mb-3 mt-5 text-xs font-bold uppercase tracking-widest text-neutral-500">
            Contact
          </h4>
          <div className="flex flex-col gap-2 text-sm">
            <a href="mailto:support@fees101.com" className="transition-colors hover:text-paper">
              support@fees101.com
            </a>
          </div>
        </div>

        <div>
          <h4 className="mb-3 text-xs font-bold uppercase tracking-widest text-neutral-500">
            Registered office
          </h4>
          <address className="text-sm not-italic leading-relaxed text-neutral-300">
            <strong className="font-bold text-paper">FEES101 LTD</strong>
            <br />
            Plot L182, Ellicot Citi Street,
            <br />
            Kubwa Extension III, Bwari,
            <br />
            FCT, Nigeria
            <br />
            RC 9694725
          </address>
        </div>
      </div>

      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 border-t border-neutral-800 pt-5 text-xs text-neutral-500">
        <span>&copy; {new Date().getFullYear()} FEES101 LTD. All rights reserved.</span>
        <span>RC 9694725 &middot; Bwari, FCT, Nigeria</span>
      </div>
    </footer>
  );
}
