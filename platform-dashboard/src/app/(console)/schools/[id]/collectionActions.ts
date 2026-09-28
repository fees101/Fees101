'use server'

import { revalidatePath } from 'next/cache'
import { getPlatformAdmin } from '@/lib/auth'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { provisionPlatformDvaForSchool } from '@/lib/platformDva'

// Server actions for the platform-collection (school-pays-into-DVA) panel.
// Kept separate from actions.ts (the card-billing actions) so the two flows
// stay independent.

async function requireAdmin() {
  const admin = await getPlatformAdmin()
  if (!admin) throw new Error('Not authenticated')
  return admin
}

export interface CollectionCharge {
  id: string
  amount: number
  method: string
  status: string
  paidAt: string | null
  createdAt: string
}

export interface CollectionData {
  dva: {
    accountNumber: string | null
    bankName: string | null
    reference: string | null
  } | null
  billingStatus: string | null
  charges: CollectionCharge[]
}

// Provision (idempotently) the school's platform DVA. Gated by platform admin.
export async function provisionSchoolPlatformDva(
  schoolId: string
): Promise<{ accountNumber: string; bankName: string } | { error: string }> {
  try {
    await requireAdmin()
    const dva = await provisionPlatformDvaForSchool(schoolId)
    revalidatePath(`/schools/${schoolId}`)
    return { accountNumber: dva.accountNumber, bankName: dva.bankName }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to provision payment account.' }
  }
}

// Load the collection panel's data (DVA details, billing status, recent
// DVA-transfer charges). Standalone so the panel only needs a schoolId.
export async function getSchoolCollectionData(schoolId: string): Promise<CollectionData> {
  await requireAdmin()
  const supabase = createServiceRoleClient()

  const { data: billing } = await supabase
    .from('platform_billing')
    .select('platform_dva_account_number, platform_dva_bank_name, platform_dva_reference, billing_status')
    .eq('school_id', schoolId)
    .maybeSingle()

  const { data: charges } = await supabase
    .from('platform_billing_charges')
    .select('id, amount, method, status, paid_at, created_at')
    .eq('school_id', schoolId)
    .order('created_at', { ascending: false })
    .limit(10)

  return {
    dva: billing?.platform_dva_reference
      ? {
          accountNumber: billing.platform_dva_account_number,
          bankName: billing.platform_dva_bank_name,
          reference: billing.platform_dva_reference,
        }
      : null,
    billingStatus: billing?.billing_status ?? null,
    charges: (charges ?? []).map(c => ({
      id: c.id as string,
      amount: Number(c.amount) || 0,
      method: c.method as string,
      status: c.status as string,
      paidAt: c.paid_at as string | null,
      createdAt: c.created_at as string,
    })),
  }
}
