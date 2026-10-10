import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Fees101 — Platform Console',
}

// Reads the saved theme choice (see ThemeToggle.tsx) and sets it on <html>
// before first paint, so switching to light mode doesn't flash dark first.
// Inline + blocking on purpose; this is the one place a <script> tag belongs
// in this app. Wrapped in try/catch per the usual private-window/blocked-
// storage defensiveness — falls back to the dark default silently.
const THEME_INIT_SCRIPT = `
try {
  var t = localStorage.getItem('fees101-console-theme');
  if (t === 'light') document.documentElement.setAttribute('data-theme', 'light');
} catch (e) {}
`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;800&display=swap"
          rel="stylesheet"
        />
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  )
}
