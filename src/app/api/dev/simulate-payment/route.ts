// DEV-ONLY: exercises applyMonnifyPayment directly, bypassing Monnify entirely.
// For local testing of payment-confirmation SMS wiring without a real transfer.
// Refuses to run unless NODE_ENV is development.

import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { applyMonnifyPayment } from '@/lib/payments/applyPayment'

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Not available' }, { status: 404 })
  }

  const { studentId, amount } = await request.json()
  if (!studentId || !amount) {
    return NextResponse.json({ error: 'studentId and amount are required' }, { status: 400 })
  }

  const supabase = createServiceRoleClient()
  const { data: student, error: studentErr } = await supabase
    .from('students')
    .select('id, school_id')
    .eq('id', studentId)
    .single()

  if (studentErr || !student) {
    return NextResponse.json({ error: 'Student not found' }, { status: 404 })
  }

  const ref = `dev-sim-${Date.now()}`
  try {
    const result = await applyMonnifyPayment({
      supabase,
      schoolId: student.school_id,
      studentId: student.id,
      amountPaid: Number(amount),
      settlementAmount: Number(amount),
      providerReference: ref,
      providerTransactionId: ref,
      paidAt: new Date().toISOString(),
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Unknown error' }, { status: 500 })
  }
}
