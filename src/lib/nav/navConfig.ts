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
  href: '/today',
  label: 'Dashboard',
  icon: ['M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1h3a1 1 0 001-1V10'],
}

export const sections: NavSection[] = [
  {
    title: 'School',
    items: [
      {
        href: '/today/record',
        label: 'Recent activity',
        perm: 'see-activity',
        icon: ['M13 10V3L4 14h7v7l9-11h-7z'],
      },
      {
        href: '/school/academic-structure',
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
        href: '/money/invoices',
        label: 'Invoices',
        perm: 'see-invoices',
        icon: ['M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z'],
      },
      {
        href: '/money/collections',
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
        href: '/money/reports',
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
        href: '/school',
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
// (today/page.tsx), so showing a separate "Dashboard" entry that just
// bounces to the same place a moment later would be misleading — hide it in
// that case. Any other outcome (real widgets, or the fallback grid because
// there's zero or multiple reachable pages) is a distinct destination.
export function showsDashboardLink(permissions: Set<string>, isOwner: boolean): boolean {
  if (hasDashboardWidgets(permissions, isOwner)) return true
  return getPermissionScopedNavItems(permissions, isOwner).length !== 1
}

// ── 7-workspace shell (Modernist redesign) ─────────────────────────────────
// The sidebar groups the app into seven labelled workspaces under two
// headings, OPERATE and CONFIGURE. Each workspace's sub-views ("modes") are
// NOT separate sidebar entries — they render as in-page tabs in the page
// header. Every mode points at a real route and carries that route's own
// permission gate, so this regrouping changes ZERO access: a mode is visible
// exactly when its route was reachable in the old sidebar. The old
// `topItem`/`sections` exports and their helpers above are kept as the source
// of truth for the dashboard's redirect/fallback logic and are untouched.

export type WorkspaceGroup = 'Operate' | 'Configure'

export interface NavMode {
  href: string
  label: string
  exact?: boolean
  // Same shape/meaning as NavItem.perm — a string, or "any of" an array.
  perm?: string | string[]
  // The dashboard's visibility isn't a flat permission (it depends on whether
  // the role has widgets or a single scoped destination). Defers to
  // showsDashboardLink instead of a perm check.
  dashboard?: boolean
  // Owner/super_admin only, never delegable — mirrors SettingsNav's ownerOnly
  // (used by Data & privacy).
  ownerOnly?: boolean
}

export interface Workspace {
  key: string
  label: string
  group: WorkspaceGroup
  // Route prefixes this workspace owns, for active-state detection. The
  // longest prefix that matches the current path wins, so two workspaces that
  // both live under /school resolve to the more specific one.
  match: string[]
  modes: NavMode[]
}

export const workspaces: Workspace[] = [
  // ── OPERATE ──────────────────────────────────────────────────────────────
  {
    key: 'today',
    label: 'Today',
    group: 'Operate',
    match: ['/today', '/today/record'],
    modes: [
      { href: '/today', label: 'Now', exact: true, dashboard: true },
      { href: '/today/record', label: 'Record', perm: 'see-activity' },
    ],
  },
  {
    key: 'students',
    label: 'Students',
    group: 'Operate',
    match: ['/students'],
    modes: [
      { href: '/students', label: 'Roster', perm: 'see-students', exact: true },
      { href: '/students/import', label: 'Import', perm: 'manage-students' },
      { href: '/students/payment-accounts', label: 'Payment accounts', perm: 'manage-payment-config' },
    ],
  },
  {
    key: 'fees',
    label: 'Fees',
    group: 'Operate',
    match: ['/fees'],
    modes: [
      // Matches the App Shell Fees workspace exactly: Structure, Cycles, Close
      // term, Year end. There is no Overview tab in the design — the old
      // /fees KPI landing was pre-redesign and now redirects to Structure.
      // Close term and Year end were buried (a cycle-detail modal, and a
      // separate /fees/year-end route); the design promotes both to first-class
      // tabs, each showing a pre-run ledger before the irreversible action.
      { href: '/fees/structure', label: 'Structure', perm: 'see-fee-structure' },
      { href: '/fees/cycles', label: 'Cycles', perm: 'see-fee-structure' },
      { href: '/fees/close-term', label: 'Close term', perm: 'manage-fee-structure' },
      { href: '/fees/year-end', label: 'Year end', perm: 'run-year-end' },
    ],
  },
  {
    key: 'money',
    label: 'Money',
    group: 'Operate',
    match: ['/money/invoices', '/money/collections', '/money/reports'],
    modes: [
      { href: '/money/invoices', label: 'Invoices', perm: 'see-invoices' },
      { href: '/money/collections', label: 'Collections', perm: 'see-analytics' },
      { href: '/money/reports', label: 'Reports', perm: 'see-reports' },
    ],
  },
  {
    key: 'discounts',
    label: 'Discounts',
    group: 'Operate',
    match: ['/discounts'],
    modes: [
      { href: '/discounts', label: 'Queue', perm: ['see-discounts', 'approve-discounts'] },
    ],
  },
  // ── CONFIGURE ──────────────────────────────────────────────────────────────
  {
    key: 'school',
    label: 'School',
    group: 'Configure',
    match: ['/school', '/school/academic-structure', '/school/payments', '/school/reminders', '/school/discounts'],
    modes: [
      { href: '/school', label: 'Profile', exact: true, perm: 'manage-school-profile' },
      { href: '/school/academic-structure', label: 'Academic structure', perm: 'manage-academic-structure' },
      { href: '/school/payments', label: 'Payments', perm: 'manage-payment-config' },
      { href: '/school/reminders', label: 'Reminders', perm: 'manage-reminder-config' },
      { href: '/school/discounts', label: 'Discount policy', perm: 'manage-discount-config' },
    ],
  },
  {
    key: 'team',
    label: 'Team & Trust',
    group: 'Configure',
    match: ['/team/users', '/team/roles-permissions', '/team/audit-log', '/team/data-privacy', '/team/account-security'],
    modes: [
      { href: '/team/users', label: 'Users', perm: 'manage-team' },
      { href: '/team/roles-permissions', label: 'Roles', perm: 'manage-team' },
      { href: '/team/audit-log', label: 'Audit log', perm: 'see-audit-log' },
      { href: '/team/data-privacy', label: 'Data & privacy', ownerOnly: true },
      // No perm: every signed-in user can reach their own account security,
      // exactly as the old settings landing allowed.
      { href: '/team/account-security', label: 'Security' },
    ],
  },
]

// Whether a single mode is visible to this role. Reuses the same "any of"
// rule as canSeeNavItem, with the two special cases (dashboard, ownerOnly).
export function canSeeMode(mode: NavMode, permissions: Set<string>, isOwner: boolean): boolean {
  if (mode.dashboard) return showsDashboardLink(permissions, isOwner)
  if (mode.ownerOnly) return isOwner
  if (!mode.perm) return true
  if (isOwner) return true
  const perms = Array.isArray(mode.perm) ? mode.perm : [mode.perm]
  return perms.some(p => permissions.has(p))
}

// The modes of a workspace this role can actually reach, in order.
export function accessibleModes(ws: Workspace, permissions: Set<string>, isOwner: boolean): NavMode[] {
  return ws.modes.filter(m => canSeeMode(m, permissions, isOwner))
}

// A workspace shows in the sidebar only if the role can reach at least one of
// its modes. Its landing route is that first reachable mode — so a role that
// can see Collections but not Invoices lands Money on /money/collections, never on a
// page it would be bounced off of.
export function workspaceLanding(ws: Workspace, permissions: Set<string>, isOwner: boolean): string | null {
  const first = accessibleModes(ws, permissions, isOwner)[0]
  return first ? first.href : null
}

// The workspace that owns the current path, by longest matching prefix — so
// /team/users resolves to Team & Trust (match '/team/users') rather
// than School (match '/school'), and /school itself resolves to School.
export function activeWorkspaceKey(pathname: string): string | null {
  let bestKey: string | null = null
  let bestLen = -1
  for (const ws of workspaces) {
    for (const p of ws.match) {
      if ((pathname === p || pathname.startsWith(p + '/')) && p.length > bestLen) {
        bestLen = p.length
        bestKey = ws.key
      }
    }
  }
  return bestKey
}
