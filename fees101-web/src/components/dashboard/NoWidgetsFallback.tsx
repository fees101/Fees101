import Link from 'next/link'
import type { NavItem } from '@/lib/nav/navConfig'

interface Props {
  items: NavItem[]
}

// Shown instead of a blank dashboard when a role has no permissions that
// unlock any of the KPI/chart/activity widgets above, and has more than one
// reachable page (exactly one reachable page redirects straight there
// instead - see today/page.tsx). Hide-don't-tease: when the viewer has other
// places to go, just point them there without dwelling on the figures they
// can't see. Only the genuine dead-end (a brand-new account with nothing
// reachable at all) gets a "nothing yet, ask an admin" line, because there it
// is actually the helpful next step.
export default function NoWidgetsFallback({ items }: Props) {
  return (
    <section className="m-panel">
      {items.length > 0 ? (
        <>
          <h2 className="text-[22px] font-extrabold text-[var(--color-ink)] mb-1">Where to go</h2>
          <p className="text-[14px] text-[var(--color-neutral-800)] leading-[1.5] max-w-[58ch] mb-2">
            Open any of these:
          </p>
          <div>
            {items.map(item => (
              <Link
                key={item.href}
                href={item.href}
                className="m-row grid items-baseline gap-4 py-3.5 hover:bg-[var(--color-surface)] transition-colors"
                style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}
              >
                <p className="text-[15px] font-semibold text-[var(--color-ink)]">{item.label}</p>
                <p className="text-[12px] font-semibold tracking-[0.08em] uppercase text-[var(--color-neutral-700)]">Open →</p>
              </Link>
            ))}
          </div>
        </>
      ) : (
        <>
          <h2 className="text-[22px] font-extrabold text-[var(--color-ink)] mb-1">Nothing to show yet</h2>
          <p className="text-[14px] text-[var(--color-neutral-800)] leading-[1.5] max-w-[58ch]">
            Your account hasn&apos;t been set up with access yet. Ask your school&apos;s owner or an admin to set it up.
          </p>
        </>
      )}
    </section>
  )
}
