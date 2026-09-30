import { workspaces, workspaceLanding } from '@/lib/nav/navConfig'

// Every workspace this build knows about, unfiltered by permission — a 404 is
// reachable before we know who's signed in (or while signed out entirely), so
// this lists every destination rather than gating on a role we can't check
// here. Landing on a workspace the visitor can't reach behaves exactly as it
// already does everywhere else: the destination page's own permission gate
// redirects or shows its own denied state. No new logic, just a link list.
const ALL_PERMS = new Set<string>()

export default function NotFound() {
  const links = workspaces
    .map(ws => ({ label: ws.label, href: workspaceLanding(ws, ALL_PERMS, true) }))
    .filter((w): w is { label: string; href: string } => !!w.href)

  return (
    <main className="min-h-screen bg-[var(--color-paper)] flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-[560px]">
        <p className="text-[11px] font-semibold tracking-[0.12em] text-[var(--color-neutral-700)] mb-3">NOT FOUND</p>
        <h1 className="text-3xl font-extrabold tracking-[-0.02em] text-[var(--color-ink)] mb-3 leading-[1.15]">
          That page does not exist
        </h1>
        <p className="text-sm leading-[1.6] text-[var(--color-neutral-800)] mb-8 max-w-[52ch]">
          Usually a stale bookmark from an old link. Here is everywhere in Fees101 you can go instead.
        </p>

        <div className="border-t-2 border-[var(--color-ink)]">
          {links.map(link => (
            <a
              key={link.href}
              href={link.href}
              className="flex items-center justify-between gap-4 py-3 border-b border-[var(--color-neutral-300)] text-sm font-semibold text-[var(--color-ink)] hover:bg-[var(--color-neutral-200)]"
            >
              <span>{link.label}</span>
              <span className="text-[var(--color-neutral-500)]" aria-hidden>&rarr;</span>
            </a>
          ))}
        </div>
      </div>
    </main>
  )
}
