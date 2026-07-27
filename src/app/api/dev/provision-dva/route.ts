// DEV-ONLY: provisions a Monnify DVA for an existing student outside the
// normal add-student/CSV-import flows, for backend testing of a manually
// created test student. Refuses to run unless NODE_ENV is development.

import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { getPaymentProviderForSchool } from '@/lib/payments/getProvider'
import { provisionStudentDVA } from '@/lib/payments/provisionDVA'

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Not available' }, { status: 404 })
  }

  const { studentId } = await request.json()
  if (!studentId) {
    return NextResponse.json({ error: 'studentId is required' }, { status: 400 })
  }

  const supabase = createServiceRoleClient()
  const { data: student, error: studentErr } = await supabase
    .from('students')
    .select('id, school_id, first_name, last_name, provider_dva_reference')
    .eq('id', studentId)
    .single()

  if (studentErr || !student) {
    return NextResponse.json({ error: 'Student not found' }, { status: 404 })
  }
  if (student.provider_dva_reference) {
    return NextResponse.json({ error: 'Student already has a DVA' }, { status: 400 })
  }

  const provider = await getPaymentProviderForSchool(student.school_id, supabase)
  if (!provider) {
    return NextResponse.json({ error: 'No payment provider configured for this school' }, { status: 400 })
  }

  try {
    const result = await provisionStudentDVA(
      supabase,
      student.school_id,
      provider,
      studentId,
      `${student.first_name} ${student.last_name}`.trim()
    )
    return NextResponse.json({ success: true, ...result })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'unknown error' }, { status: 500 })
  }
}
