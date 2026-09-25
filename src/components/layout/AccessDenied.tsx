import Link from 'next/link'
import { PERMISSIONS } from '@/lib/auth/permissionCatalog'
import { getAccessibleNavItems } from '@/lib/nav/navConfig'
import type { AuthContext } from '@/lib/auth/permissions'

interface Props {
  ctx: AuthContext
  // A catalog key (renders "Your role cannot {label}"), a raw label override
  // for pages reachable via more than one permission (e.g. "see discounts or
  // approve discounts"), or ownerOnly for pages that aren't grantable through
  // roles at all.
  permissionKey?: string
  label?: string
  ownerOnly?: boolean
  // False when nested inside SettingsPageShell, which already applies the
  // page gutter/padding — avoids doubling it up.
  padded?: boolean
}

function lowerFirst(s: string): string {
  return s.length ? s.charAt(0).toLowerCase() + s.slice(1) : s
}

// Whole-page permission-denied state, shown in place of a page's real content
// instead of silently redirect()ing a narrow role elsewhere. Per Auth &
// Edges.dc.html's PERMISSION error spec: "Not a blank page and not a 404.
// Names the permission in the same words the roles matrix uses, names who can
// grant it, and shows everything on the page the role IS allowed to see."
// Callers keep their own WorkspaceHeader/SettingsPageShell above this so the
// page still looks like itself, just with this in place of the gated content.
export default async function AccessDenied({ ctx, permissionKey, label: labelOverride, ownerOnly, padded = true }: Props) {
  let title: string
  let body: string

  if (ownerOnly) {
    title = 'Only the school owner can open this'
    body = "This page is limited to the account owner and isn't something a role can be granted."
  } else {
    const label = labelOverride ?? PERMISSIONS.find(p => p.key === permissionKey)?.label ?? permissionKey ?? 'do this'
    const { data: owner } = await ctx.supabase
      .from('users')
      .select('name')
      .eq('school_id', ctx.schoolId)
      .eq('role', 'school_admin')
      .maybeSingle()
    title = `Your role cannot ${lowerFirst(label)}`
    body = `Ask ${owner?.name || 'your school owner'} to grant it from Team & Trust → Roles.`
  }

  const items = getAccessibleNavItems(ctx.permissions, ctx.isOwner)

  const content = (
    <>
      <section className="m-panel max-w-[640px]">
        <p
          className="text-[12px] font-semibold uppercase tracking-[0.08em] mb-2 pl-2.5"
          style={{ color: 'var(--color-ochre-text)', borderLeft: '2px solid var(--color-ochre)' }}
        >
          Not available to your role
        </p>
        <h2 className="text-[22px] font-extrabold text-[var(--color-ink)] mb-1">{title}</h2>
        <p className="text-[14px] text-[var(--color-neutral-800)] leading-[1.5] max-w-[58ch]">{body}</p>
      </section>
      {items.length > 0 && (
        <section className="m-panel mt-7">
          <h3 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[var(--color-neutral-700)] mb-1">What you can open instead</h3>
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
        </section>
      )}
    </>
  )

  return padded ? <div className="px-4 sm:px-7 py-7">{content}</div> : content
}
