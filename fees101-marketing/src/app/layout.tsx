import type { Metadata } from "next";
import { Archivo, JetBrains_Mono } from "next/font/google";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { SITE_URL, SITE_NAME, SUPPORT_EMAIL, OG_DEFAULTS, jsonLdScriptProps } from "@/lib/seo";
import "./globals.css";

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "600", "800"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin", "latin-ext"],
  display: "swap",
  weight: "variable",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Fees101 — Revenue Operations Platform for Nigerian Schools",
    template: "%s — Fees101",
  },
  description:
    "Revenue operations platform for Nigerian schools — invoicing, payment tracking and automated reconciliation. FEES101 LTD, Bwari, FCT, Nigeria.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    ...OG_DEFAULTS,
    title: "Fees101 — Revenue Operations Platform for Nigerian Schools",
    description:
      "Fee structures per term/class, per-student invoicing, automated payment reconciliation and a live collection dashboard — built for Nigerian schools.",
    url: SITE_URL,
  },
  twitter: {
    card: "summary_large_image",
    title: "Fees101 — Revenue Operations Platform for Nigerian Schools",
    description:
      "Fee structures per term/class, per-student invoicing, automated payment reconciliation and a live collection dashboard — built for Nigerian schools.",
  },
};

// Organization schema — describes FEES101 LTD itself (not a specific page).
// Rendered once, site-wide, on the root layout so every page carries it.
const ORGANIZATION_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: SITE_NAME,
  legalName: "FEES101 LTD",
  url: SITE_URL,
  logo: `${SITE_URL}/icon.png`,
  description:
    "Fees101 is a revenue operations platform for Nigerian schools — invoicing, payment tracking, automated reconciliation and a dedicated virtual bank account per student.",
  identifier: {
    "@type": "PropertyValue",
    propertyID: "RC",
    value: "9694725",
  },
  address: {
    "@type": "PostalAddress",
    streetAddress: "Plot L182, Ellicot Citi Street, Kubwa Extension III, Bwari",
    addressRegion: "FCT",
    addressCountry: "NG",
  },
  contactPoint: {
    "@type": "ContactPoint",
    email: SUPPORT_EMAIL,
    contactType: "customer support",
    areaServed: "NG",
  },
};

// SoftwareApplication schema — describes the Fees101 product so answer
// engines can characterise what the software does. No price / no Offer:
// pricing is deliberately unpublished (quoted per school).
const SOFTWARE_APPLICATION_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: SITE_NAME,
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  url: SITE_URL,
  description:
    "Revenue operations platform for Nigerian schools. Fee structures per class and term, per-student invoicing with balances carried forward, a dedicated virtual bank account per student, automatic payment reconciliation and a live collection dashboard.",
  inLanguage: "en-NG",
  areaServed: "NG",
  provider: {
    "@type": "Organization",
    name: SITE_NAME,
    legalName: "FEES101 LTD",
    url: SITE_URL,
  },
  publisher: {
    "@type": "Organization",
    name: SITE_NAME,
    legalName: "FEES101 LTD",
    url: SITE_URL,
  },
  featureList: [
    "Fee schedules per class and term",
    "Per-student invoices with balances carried forward",
    "A dedicated virtual bank account for every student",
    "Family accounts with a shared virtual account across siblings, so a parent can pay once",
    "Automatic payment reconciliation",
    "Live collection dashboard",
    "SMS notifications",
    "Bulk CSV student onboarding",
    "Self-service payment provider settings",
    "Encrypted provider credentials (AES-256-GCM)",
  ],
};

// WebSite schema — identifies the site itself. No SearchAction: there is no
// site search to point an engine at.
const WEBSITE_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: SITE_NAME,
  url: SITE_URL,
  inLanguage: "en-NG",
  publisher: {
    "@type": "Organization",
    name: SITE_NAME,
    legalName: "FEES101 LTD",
    url: SITE_URL,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${archivo.variable} ${jetbrainsMono.variable} flex min-h-screen flex-col font-sans antialiased`}
      >
        <script {...jsonLdScriptProps(ORGANIZATION_JSON_LD)} />
        <script {...jsonLdScriptProps(SOFTWARE_APPLICATION_JSON_LD)} />
        <script {...jsonLdScriptProps(WEBSITE_JSON_LD)} />
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
