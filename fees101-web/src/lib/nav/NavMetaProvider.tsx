'use client'

import { createContext, useContext, useMemo } from 'react'

// ---------------------------------------------------------------------------
// Client-side nav metadata context — live, per-school data the sidebar's
// workspace-row badges and WorkspaceHeader's in-page mode-tab badges both
// need, resolved once in the (app) layout (server) and handed down here so
// neither has to re-fetch it. Mirrors PermissionsProvider's shape exactly.
//
// Split out from PermissionsProvider because this is live counts/flags, not
// the signed-in user's own identity — a workspace row's badge count and a
// mode tab's small pending-count badge (e.g. Money's Refunds/Manual payments
// tabs) both read `counts`; a mode gated on a per-school feature flag (e.g.
// Manual payments) reads `manualPaymentsEnabled`.
// ---------------------------------------------------------------------------

interface NavMetaValue {
  counts: Record<string, number>
  manualPaymentsEnabled: boolean
}

const NavMetaContext = createContext<NavMetaValue>({
  counts: {},
  manualPaymentsEnabled: false,
})

export function NavMetaProvider({
  counts,
  manualPaymentsEnabled,
  children,
}: {
  counts: Record<string, number>
  manualPaymentsEnabled: boolean
  children: React.ReactNode
}) {
  const value = useMemo<NavMetaValue>(
    () => ({ counts, manualPaymentsEnabled }),
    [counts, manualPaymentsEnabled],
  )
  return <NavMetaContext.Provider value={value}>{children}</NavMetaContext.Provider>
}

export function useNavMeta(): NavMetaValue {
  return useContext(NavMetaContext)
}
