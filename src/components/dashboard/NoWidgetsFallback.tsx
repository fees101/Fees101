import Link from 'next/link'
import type { NavItem } from '@/lib/nav/navConfig'

interface Props {
  items: NavItem[]
}

// Shown instead of a blank dashboard when a role has no permissions that
// unlock any of the KPI/chart/activity widgets above, and has more than one
// reachable page (exactly one reachable page redirects straight there
// instead - see today/page.tsx). Follows the same empty-state discipline as
// the "Needs you" panel it replaces: name what's missing, then show
// everything the role IS allowed to see, in the same .m-panel/.m-row idiom
// as the rest of Today rather than a generic card grid.
export default function NoWidgetsFallback({ items }: Props) {
  return (
    <section className="m-panel">
      <h2 className="text-[22px] font-extrabold text-[var(--color-ink)] mb-1">Nothing here for your role</h2>
      <p className="text-[14px] text-[var(--color-neutral-800)] leading-[1.5] max-w-[58ch] mb-2">
        {items.length > 0
          ? "Your role doesn't unlock any of Today's figures. Here's what you can open instead:"
          : "Your role doesn't unlock any of Today's figures, or anywhere else yet — ask your school's owner or an admin to grant access."}
      </p>
      {items.length > 0 && (
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
      )}
    </section>
  )
}
