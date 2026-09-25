import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import "./globals.css";

// Archivo is a variable font on Google Fonts, so the 400/600/800 weights the
// Modernist system uses all load from this single request.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Fees101", template: "%s · Fees101" },
  description: "Nigerian school fee collection platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={archivo.variable}>{children}</body>
    </html>
  );
}
