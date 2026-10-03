import { redirect } from 'next/navigation'
import { getAuthContext } from '@/lib/auth/permissions'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import {
  setupFeeNaira,
  FREE_DAYS,
  PRICE_PER_STUDENT_MONTH,
  BILLING_TERMS_VERSION,
} from '@/lib/platformBilling/config'
import ConnectBillingForm from './ConnectBillingForm'

export const metadata = { title: 'Connect billing · Fees101' }

// The required billing step, shown right after the owner sets their password and
// before they can enter the app. Lives OUTSIDE the (app) route group so the
// app-layout gate can redirect here without looping. Auth is still enforced here.
export default async function ConnectBillingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; checked?: string }>
}) {
  const ctx = await getAuthContext()
  if (!ctx || !ctx.schoolId) redirect('/login')

  const svc = createServiceRoleClient()

  // Already connected? Don't show the step again.
  const { data: billing } = await svc
    .from('platform_billing')
    .select('billing_connected_at, platform_dva_account_number, platform_dva_bank_name')
    .eq('school_id', ctx.schoolId)
    .maybeSingle()
  if (billing?.billing_connected_at) redirect('/today')

  const { data: school } = await svc
    .from('schools')
    .select('name')
    .eq('id', ctx.schoolId)
    .maybeSingle()

  const { error: errorCode, checked } = await searchParams

  return (
    <ConnectBillingForm
      schoolName={school?.name || 'your school'}
      setupFee={setupFeeNaira()}
      freeDays={FREE_DAYS}
      pricePerStudent={PRICE_PER_STUDENT_MONTH}
      termsVersion={BILLING_TERMS_VERSION}
      isOwner={ctx.isOwner}
      initialErrorCode={errorCode || null}
      checkedForTransfer={checked === '1'}
      existingDva={
        billing?.platform_dva_account_number
          ? { accountNumber: billing.platform_dva_account_number, bankName: billing.platform_dva_bank_name || '' }
          : null
      }
    />
  )
}
