import { createServiceRoleClient } from './supabase/serviceRole'

export interface SchoolOverviewRow {
  id: string
  name: string
  createdAt: string
  subscriptionStatus: string
  billingStatus: string
  annualPrice: number
  termsPerYear: number
  studentCount: number
}

export async function getSchoolsOverview(): Promise<SchoolOverviewRow[]> {
  const supabase = createServiceRoleClient()

  const [{ data: schools }, { data: billing }, { data: students }] = await Promise.all([
    supabase.from('schools').select('id, name, created_at, subscription_status, terms_per_year'),
    supabase.from('platform_billing').select('school_id, billing_status, annual_price'),
    supabase.from('students').select('school_id').eq('status', 'active'),
  ])

  const billingBySchool = new Map((billing || []).map(b => [b.school_id, b]))
  const studentCountByschool = new Map<string, number>()
  ;(students || []).forEach(s => {
    studentCountByschool.set(s.school_id, (studentCountByschool.get(s.school_id) || 0) + 1)
  })

  return (schools || []).map(s => {
    const b = billingBySchool.get(s.id)
    return {
      id: s.id,
      name: s.name,
      createdAt: s.created_at,
      subscriptionStatus: s.subscription_status,
      billingStatus: b?.billing_status || 'active',
      annualPrice: Number(b?.annual_price || 0),
      termsPerYear: s.terms_per_year || 3,
      studentCount: studentCountByschool.get(s.id) || 0,
    }
  })
}

export interface SchoolUsage {
  smsCount: number
  smsCost: number
  emailCount: number
  emailCost: number
  totalCost: number
  // No byte-level storage accounting exists anywhere in the schools-facing
  // app (only row counts, via its Data & Privacy inventory). Row count
  // across the heaviest tables is used here as a rough load proxy until a
  // real storage-size job exists.
  rowCountProxy: number
}

export async function getSchoolUsage(schoolId: string): Promise<SchoolUsage> {
  const supabase = createServiceRoleClient()

  const { data: messages } = await supabase
    .from('message_logs')
    .select('channel, cost_amount')
    .eq('school_id', schoolId)

  let smsCount = 0, smsCost = 0, emailCount = 0, emailCost = 0
  ;(messages || []).forEach(m => {
    const cost = Number(m.cost_amount || 0)
    if (m.channel === 'sms') { smsCount++; smsCost += cost }
    else if (m.channel === 'email') { emailCount++; emailCost += cost }
  })

  const [{ count: studentRows }, { count: invoiceRows }, { count: messageRows }] = await Promise.all([
    supabase.from('students').select('id', { count: 'exact', head: true }).eq('school_id', schoolId),
    supabase.from('invoices').select('id', { count: 'exact', head: true }).eq('school_id', schoolId),
    supabase.from('message_logs').select('id', { count: 'exact', head: true }).eq('school_id', schoolId),
  ])

  return {
    smsCount,
    smsCost,
    emailCount,
    emailCost,
    totalCost: smsCost + emailCost,
    rowCountProxy: (studentRows || 0) + (invoiceRows || 0) + (messageRows || 0),
  }
}

export interface SchoolDetail {
  id: string
  name: string
  termsPerYear: number
  billing: {
    annualPrice: number
    billingStatus: string
    nextChargeDueAt: string | null
    lastChargedAt: string | null
    lastChargeAmount: number | null
    hasSavedCard: boolean
    cardLast4: string | null
    paystackEmail: string | null
  }
  charges: { id: string; amount: number; status: string; createdAt: string; failureReason: string | null }[]
  auditLog: { id: string; actorName: string; action: string; summary: string; createdAt: string }[]
}

export async function getSchoolDetail(schoolId: string): Promise<SchoolDetail | null> {
  const supabase = createServiceRoleClient()

  const [{ data: school }, { data: billing }, { data: charges }, { data: audit }] = await Promise.all([
    supabase.from('schools').select('id, name, terms_per_year').eq('id', schoolId).maybeSingle(),
    supabase.from('platform_billing').select('*').eq('school_id', schoolId).maybeSingle(),
    supabase.from('platform_billing_charges').select('id, amount, status, created_at, failure_reason').eq('school_id', schoolId).order('created_at', { ascending: false }).limit(20),
    supabase.from('platform_audit_log').select('id, actor_name, action, summary, created_at').eq('school_id', schoolId).order('created_at', { ascending: false }).limit(20),
  ])

  if (!school) return null

  return {
    id: school.id,
    name: school.name,
    termsPerYear: school.terms_per_year || 3,
    billing: {
      annualPrice: Number(billing?.annual_price || 0),
      billingStatus: billing?.billing_status || 'active',
      nextChargeDueAt: billing?.next_charge_due_at || null,
      lastChargedAt: billing?.last_charged_at || null,
      lastChargeAmount: billing?.last_charge_amount ? Number(billing.last_charge_amount) : null,
      hasSavedCard: !!billing?.paystack_authorization_code,
      cardLast4: null,
      paystackEmail: billing?.paystack_email || null,
    },
    charges: (charges || []).map(c => ({
      id: c.id,
      amount: Number(c.amount),
      status: c.status,
      createdAt: c.created_at,
      failureReason: c.failure_reason,
    })),
    auditLog: (audit || []).map(a => ({
      id: a.id,
      actorName: a.actor_name,
      action: a.action,
      summary: a.summary,
      createdAt: a.created_at,
    })),
  }
}

export async function getAllSchoolsCostToServe(): Promise<Map<string, SchoolUsage>> {
  const supabase = createServiceRoleClient()
  const { data: messages } = await supabase.from('message_logs').select('school_id, channel, cost_amount')

  const map = new Map<string, SchoolUsage>()
  ;(messages || []).forEach(m => {
    const existing = map.get(m.school_id) || { smsCount: 0, smsCost: 0, emailCount: 0, emailCost: 0, totalCost: 0, rowCountProxy: 0 }
    const cost = Number(m.cost_amount || 0)
    if (m.channel === 'sms') { existing.smsCount++; existing.smsCost += cost }
    else if (m.channel === 'email') { existing.emailCount++; existing.emailCost += cost }
    existing.totalCost = existing.smsCost + existing.emailCost
    map.set(m.school_id, existing)
  })
  return map
}
