import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import "./globals.css";

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const SITE_URL = "https://www.fees101.com";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Fees101 — School Fee Management Software for Nigerian Schools",
    template: "%s — Fees101",
  },
  description:
    "School fee management software for Nigerian schools — invoicing, payment tracking and automated reconciliation. FEES101 LTD, Bwari, FCT, Nigeria.",
  openGraph: {
    title: "Fees101 — School Fee Management Software for Nigerian Schools",
    description:
      "Fee structures per term/class, per-student invoicing, automated payment reconciliation and a live collection dashboard — built for Nigerian schools.",
    url: SITE_URL,
    siteName: "Fees101",
    locale: "en_NG",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${poppins.variable} flex min-h-screen flex-col font-sans antialiased`}>
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
