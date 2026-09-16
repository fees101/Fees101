// DEV-ONLY: exercises applyProviderPayment directly, bypassing the gateway.
// For local testing of payment-confirmation SMS wiring without a real transfer.
// Refuses to run unless NODE_ENV is development, and requires an authenticated
// staff session with invoice-management rights on top of that — the NODE_ENV
// check alone doesn't stop an unauthenticated caller on a misconfigured
// staging/preview deployment (2026-09-16 stress test).

import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { applyProviderPayment } from '@/lib/payments/applyPayment'
import { requirePermission } from '@/lib/auth/permissions'

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Not available' }, { status: 404 })
  }

  const authCtx = await requirePermission('manage-invoices')
  if (!authCtx) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  }

  const { studentId, amount, provider } = await request.json()
  const numericAmount = Number(amount)
  if (!studentId || !amount || !Number.isFinite(numericAmount) || numericAmount <= 0) {
    return NextResponse.json({ error: 'studentId and a positive numeric amount are required' }, { status: 400 })
  }
  // Attribute the simulated payment to the right provider so the payment row /
  // receipt match the school under test. Defaults to monnify for back-compat.
  const providerName = provider === 'paystack' ? 'paystack' : 'monnify'

  const supabase = createServiceRoleClient()
  const { data: student, error: studentErr } = await supabase
    .from('students')
    .select('id, school_id')
    .eq('id', studentId)
    .eq('school_id', authCtx.schoolId)
    .single()

  if (studentErr || !student) {
    return NextResponse.json({ error: 'Student not found' }, { status: 404 })
  }

  const ref = `dev-sim-${Date.now()}`
  try {
    const result = await applyProviderPayment({
      supabase,
      schoolId: student.school_id,
      studentId: student.id,
      amountPaid: numericAmount,
      settlementAmount: numericAmount,
      provider: providerName,
      providerReference: ref,
      providerTransactionId: ref,
      paidAt: new Date().toISOString(),
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Unknown error' }, { status: 500 })
  }
}
