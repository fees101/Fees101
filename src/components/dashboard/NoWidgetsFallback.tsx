import Link from 'next/link'
import type { NavItem } from '@/lib/nav/navConfig'

interface Props {
  items: NavItem[]
}

// Shown instead of a blank dashboard when a role has no permissions that
// unlock any of the KPI/chart/activity widgets above, and has more than one
// reachable page (exactly one reachable page redirects straight there
// instead — see dashboard/page.tsx).
export default function NoWidgetsFallback({ items }: Props) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <p className="text-sm text-gray-500">
        {items.length > 0
          ? "There's nothing to show on this page for your role yet. Here's what you have access to:"
          : "There's nothing to show on this page for your role yet — ask your admin if you think you should have access to more."}
      </p>
      {items.length > 0 && (
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 p-3.5 rounded-lg border border-gray-100 hover:border-mint/50 hover:bg-gray-50 transition-colors"
            >
              <div className="w-8 h-8 rounded-lg bg-mint-light flex items-center justify-center flex-shrink-0">
                <svg className="w-4 h-4 text-mint" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  {item.icon.map((d, i) => <path key={i} strokeLinecap="round" strokeLinejoin="round" d={d} />)}
                </svg>
              </div>
              <span className="text-sm font-medium text-navy">{item.label}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
