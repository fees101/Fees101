import { redirect } from 'next/navigation'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Fees' }

// The Fees workspace has no Overview tab in the App Shell design — its four
// tabs are Structure, Cycles, Close term and Year end. The old /fees KPI
// landing predated the redesign; its figures now live on Today (collection
// hero), Cycles (per-term progress) and Structure (gross potential). This
// keeps the /fees route working by landing on the first Fees tab. The sidebar
// already resolves the Fees entry to the first reachable mode, so this only
// matters for a direct hit or an old bookmark.
export default function FeesIndexPage() {
  redirect('/fees/structure')
}
