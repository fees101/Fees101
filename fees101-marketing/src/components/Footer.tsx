import Link from "next/link";
import { LogoHorizontal } from "./Logo";

const PRODUCT_LINKS = [
  { href: "/features", label: "Features" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/about", label: "About" },
  { href: "/faq", label: "FAQ" },
];

const LEGAL_LINKS = [
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms of Service" },
];

export function Footer() {
  return (
    <footer className="border-t border-white/10 bg-navy px-6 pb-6 pt-10 text-white/65">
      <div className="mx-auto grid max-w-6xl gap-8 pb-6 md:grid-cols-[1fr_1fr_1fr_1.2fr]">
        <div>
          <div className="inline-block rounded-md bg-white p-2">
            <LogoHorizontal height={28} />
          </div>
          <p className="mt-3 max-w-xs text-sm leading-relaxed text-white/55">
            School fee management software for Nigerian schools.
          </p>
        </div>

        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-widest text-mint">
            Product
          </h4>
          <div className="flex flex-col gap-1.5 text-sm">
            {PRODUCT_LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="transition-colors hover:text-white">
                {l.label}
              </Link>
            ))}
          </div>
        </div>

        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-widest text-mint">
            Legal
          </h4>
          <div className="flex flex-col gap-1.5 text-sm">
            {LEGAL_LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="transition-colors hover:text-white">
                {l.label}
              </Link>
            ))}
          </div>
          <h4 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-widest text-mint">
            Contact
          </h4>
          <div className="flex flex-col gap-1.5 text-sm">
            <a href="mailto:support@fees101.com" className="transition-colors hover:text-white">
              support@fees101.com
            </a>
          </div>
        </div>

        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-widest text-mint">
            Registered office
          </h4>
          <address className="text-sm not-italic leading-relaxed text-white/65">
            <strong className="font-bold text-white">FEES101 LTD</strong>
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

      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-4 text-xs text-white/40">
        <span>&copy; {new Date().getFullYear()} FEES101 LTD. All rights reserved.</span>
        <span>RC 9694725 &middot; Bwari, FCT, Nigeria</span>
      </div>
    </footer>
  );
}
