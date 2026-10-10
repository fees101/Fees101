'use client'

import { useEffect, useState } from 'react'
import { Sun, Moon } from '@/lib/icons'

// Dark is the console's documented default identity (a deliberate "control
// room" ground distinct from the school app's light one — see
// docs/platform-dashboard-architecture.md §3). The owner floated wanting
// light/dark rather than a forced all-black screen, so this gives a real
// per-viewer choice instead of re-guessing a single palette a third time.
// Purely a display preference — stored in localStorage only (never synced,
// never read server-side), same as any other per-viewer UI convenience.
// The blocking inline script in layout.tsx sets the initial data-theme
// attribute before paint so there's no flash of the wrong theme; this
// component only has to reflect and toggle it after hydration.
export default function ThemeToggle() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')

  useEffect(() => {
    const current = document.documentElement.getAttribute('data-theme')
    setTheme(current === 'light' ? 'light' : 'dark')
  }, [])

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.setAttribute('data-theme', next)
    try {
      localStorage.setItem('fees101-console-theme', next)
    } catch {
      // Private window / blocked storage — the toggle still works for this
      // page view, it just won't persist across a reload.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="theme-toggle"
      title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      aria-label="Toggle color theme"
    >
      {theme === 'dark' ? <Sun size={15} strokeWidth={2} /> : <Moon size={15} strokeWidth={2} />}
    </button>
  )
}
