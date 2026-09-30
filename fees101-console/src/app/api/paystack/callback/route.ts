import { NextRequest, NextResponse } from 'next/server'
import { verifyTransaction, refundTransaction } from '@/lib/paystack'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'

// Paystack redirects the browser here after the "capture a card" checkout
// (initializeCardCapture's callback_url). Verifies the transaction, pulls
// out the reusable authorization_code, refunds the small capture charge, and
// saves everything against the school's platform_billing row.
export async function GET(req: NextRequest) {
  const reference = req.nextUrl.searchParams.get('reference')
  const schoolId = req.nextUrl.searchParams.get('school_id')
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3100'

  if (!reference || !schoolId) {
    return NextResponse.redirect(`${appUrl}/schools?error=missing_reference`)
  }

  try {
    const data = await verifyTransaction(reference)
    if (data.status !== 'success' || !data.authorization?.authorization_code) {
      return NextResponse.redirect(`${appUrl}/schools/${schoolId}?error=capture_failed`)
    }

    const supabase = createServiceRoleClient()
    await supabase
      .from('platform_billing')
      .upsert(
        {
          school_id: schoolId,
          paystack_authorization_code: data.authorization.authorization_code,
          paystack_customer_code: data.customer.customer_code,
          paystack_email: data.customer.email,
          authorization_captured_at: new Date().toISOString(),
        },
        { onConflict: 'school_id' }
      )

    await supabase.from('platform_audit_log').insert({
      actor_name: 'System',
      action: 'billing.card_captured',
      school_id: schoolId,
      summary: `Saved a card ending ${data.authorization.last4} (${data.authorization.card_type}, ${data.authorization.bank})`,
      metadata: { last4: data.authorization.last4, bank: data.authorization.bank },
    })

    // Refund the small capture charge — best-effort, the authorization
    // survives the refund either way.
    try { await refundTransaction(reference) } catch { /* not fatal */ }

    return NextResponse.redirect(`${appUrl}/schools/${schoolId}?captured=1`)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown_error'
    return NextResponse.redirect(`${appUrl}/schools/${schoolId}?error=${encodeURIComponent(message)}`)
  }
}
