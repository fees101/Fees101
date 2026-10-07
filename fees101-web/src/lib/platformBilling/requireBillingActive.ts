// M2: defense-in-depth for the platform-billing entry gate.
//
// The (app) layout (layout.tsx -> getBillingGateState) already redirects a
// school that hasn't connected billing to /connect-billing, and a suspended
// school to /account-suspended, before any page renders. But that is a LAYOUT
// check: a server action or route handler can be invoked directly (a stale open
// tab left over from before suspension, a replayed/scripted request) without the
// layout ever running again. Without this guard, such a call could still mutate
// money or school data while the school is unconnected or suspended for
// non-payment.
//
// Call requireBillingActive() at the top of server actions that MUTATE money or
// school data. Read-only actions don't need it (the gate is about USING the
// product to keep operating, not about reading your own data back). The
// billing-recovery actions must NOT call it, or a suspended / unconnected school
// could never pay its way back in:
//   - connect-billing/actions.ts (startBillingConnection, startDvaFallback)
//   - team/platform-billing/actions.ts (startSwitchToMandate, switchToDva)

import { getAuthContext } from '@/lib/auth/permissions'
import { getBillingGateState } from './config'

// Thrown when a mutation is attempted while billing is not active. This is a
// last-resort backstop the normal UI flow never hits (the layout redirect fires
// first), so surfacing it as a thrown error is fine.
export class BillingInactiveError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BillingInactiveError'
  }
}

export async function requireBillingActive(): Promise<void> {
  const ctx = await getAuthContext()
  // No school context (super_admin / platform) is never gated, matching the layout.
  if (!ctx?.schoolId) return
  // An impersonating platform admin bypasses the gate, matching the layout
  // (they need to inspect exactly the unconnected / suspended schools).
  if (ctx.isImpersonating) return

  const gate = await getBillingGateState(ctx.schoolId)
  if (!gate.connected) {
    throw new BillingInactiveError('Billing is not connected for this school.')
  }
  if (gate.suspended) {
    throw new BillingInactiveError('This school is suspended for non-payment.')
  }
}

// Non-throwing variant for the normal call sites (server actions that return
// `{ error: string } | ...`). BUG FOUND 2026-10-07: every call site did
// `await requireBillingActive()` with no try/catch, so the thrown
// BillingInactiveError propagated uncaught all the way to Next.js's error
// overlay/boundary — a raw crash screen instead of the friendly in-app error
// every other validation failure in these actions already returns. Caught live:
// a stale tab (billing flipped to unconnected/suspended underneath an already-
// open page) hit this exact crash on addStudent. The guard itself was correct
// (the mutation was genuinely blocked, confirmed independently against the
// database) — only the surfacing was broken. Every call site now uses this
// instead:
//   const billingGate = await requireBillingActiveOrError()
//   if (billingGate) return billingGate
export async function requireBillingActiveOrError(): Promise<{ error: string } | null> {
  try {
    await requireBillingActive()
    return null
  } catch (e) {
    if (e instanceof BillingInactiveError) return { error: e.message }
    throw e
  }
}
