export interface NavItem {
  href: string
  label: string
  icon: string[]
  exact?: boolean
  // Permission key(s) required to see this item. Undefined = always visible.
  // An array means "any of" — used where a page is reachable via more than
  // one permission (e.g. discounts, reachable with just approve-discounts).
  perm?: string | string[]
}

export interface NavSection {
  title: string
  items: NavItem[]
}

export const topItem: NavItem = {
  href: '/dashboard',
  label: 'Dashboard',
  icon: ['M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1h3a1 1 0 001-1V10'],
}

export const sections: NavSection[] = [
  {
    title: 'School',
    items: [
      {
        href: '/activity',
        label: 'Recent activity',
        perm: 'see-activity',
        icon: ['M13 10V3L4 14h7v7l9-11h-7z'],
      },
      {
        href: '/settings/academic-structure',
        label: 'Academic structure',
        perm: 'manage-academic-structure',
        icon: [
          'M12 14l9-5-9-5-9 5 9 5z',
          'M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z',
        ],
      },
      {
        href: '/students',
        label: 'Students',
        perm: 'see-students',
        icon: ['M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z'],
      },
    ],
  },
  {
    title: 'Fees',
    items: [
      {
        href: '/fees',
        label: 'Overview',
        exact: true,
        icon: ['M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14'],
      },
      {
        href: '/fees/structure',
        label: 'Fee structure',
        perm: 'see-fee-structure',
        icon: ['M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4'],
      },
      {
        href: '/fees/cycles',
        label: 'Billing cycles',
        perm: 'see-fee-structure',
        icon: ['M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z'],
      },
      {
        href: '/invoices',
        label: 'Invoices',
        perm: 'see-invoices',
        icon: ['M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z'],
      },
      {
        href: '/payments',
        label: 'Payments',
        perm: 'see-analytics',
        icon: ['M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z'],
      },
      {
        href: '/discounts',
        label: 'Discounts',
        perm: ['see-discounts', 'approve-discounts'],
        icon: ['M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z'],
      },
      {
        href: '/reports',
        label: 'Reports',
        perm: 'see-reports',
        icon: ['M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z'],
      },
    ],
  },
  {
    title: 'Settings',
    items: [
      {
        href: '/settings',
        label: 'School settings',
        icon: [
          'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z',
          'M15 12a3 3 0 11-6 0 3 3 0 016 0z',
        ],
      },
    ],
  },
]

// Shared "does this user see this nav item" check — same rule used by the
// sidebar and by the dashboard's narrow-permission fallback, so both always
// agree on what a given role can reach.
export function canSeeNavItem(item: NavItem, permissions: Set<string>, isOwner: boolean): boolean {
  if (!item.perm) return true
  if (isOwner) return true
  const perms = Array.isArray(item.perm) ? item.perm : [item.perm]
  return perms.some(p => permissions.has(p))
}

// All nav items this role can reach, generic always-visible ones included
// (e.g. Fees overview, School settings) — used to render the dashboard's
// narrow-permission fallback grid.
export function getAccessibleNavItems(permissions: Set<string>, isOwner: boolean): NavItem[] {
  return sections.flatMap(section => section.items).filter(item => canSeeNavItem(item, permissions, isOwner))
}

// Only items gated on a specific permission — excludes the generic
// always-visible ones, since "you can see Fees overview" isn't a meaningful
// single home page. Used to decide whether a narrow role has exactly one
// real destination worth redirecting straight to.
export function getPermissionScopedNavItems(permissions: Set<string>, isOwner: boolean): NavItem[] {
  return sections.flatMap(section => section.items).filter(item => item.perm && canSeeNavItem(item, permissions, isOwner))
}

// Permissions that unlock a dashboard widget (KPI card, chart, or feed).
// Kept in one place since both the dashboard page (what to render) and the
// sidebar (whether "Dashboard" is a real destination worth linking to) need
// to agree on this.
const DASHBOARD_WIDGET_PERMS = ['see-financial-totals', 'approve-discounts', 'request-discounts', 'see-activity']

export function hasDashboardWidgets(permissions: Set<string>, isOwner: boolean): boolean {
  return isOwner || DASHBOARD_WIDGET_PERMS.some(p => permissions.has(p))
}

// Whether "Dashboard" is worth its own sidebar link. A role with no widgets
// and exactly one other reachable page gets redirected straight there
// (dashboard/page.tsx), so showing a separate "Dashboard" entry that just
// bounces to the same place a moment later would be misleading — hide it in
// that case. Any other outcome (real widgets, or the fallback grid because
// there's zero or multiple reachable pages) is a distinct destination.
export function showsDashboardLink(permissions: Set<string>, isOwner: boolean): boolean {
  if (hasDashboardWidgets(permissions, isOwner)) return true
  return getPermissionScopedNavItems(permissions, isOwner).length !== 1
}
