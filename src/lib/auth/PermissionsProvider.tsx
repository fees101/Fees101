'use client'

import { createContext, useContext, useMemo } from 'react'

// ---------------------------------------------------------------------------
// Client-side permission context. The (app) layout resolves the current user's
// permission keys on the server and passes them here so client components
// (Sidebar, toggle UIs) can hide/show accordingly.
//
// IMPORTANT: client checks are UX-only (hide/show). Every real boundary is
// re-enforced on the server (page guards, server actions) and by RLS. Never
// rely on useCan() alone to protect data or an action.
// ---------------------------------------------------------------------------

interface PermissionsValue {
  permissions: Set<string>
  isOwner: boolean
}

const PermissionsContext = createContext<PermissionsValue>({
  permissions: new Set(),
  isOwner: false,
})

export function PermissionsProvider({
  permissions,
  isOwner,
  children,
}: {
  permissions: string[]
  isOwner: boolean
  children: React.ReactNode
}) {
  const value = useMemo<PermissionsValue>(
    () => ({ permissions: new Set(permissions), isOwner }),
    [permissions, isOwner],
  )
  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>
}

export function usePermissions(): PermissionsValue {
  return useContext(PermissionsContext)
}

export function useCan(perm: string): boolean {
  const { permissions, isOwner } = useContext(PermissionsContext)
  return isOwner || permissions.has(perm)
}
