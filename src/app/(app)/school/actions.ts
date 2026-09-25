'use server'

import { requirePermission } from '@/lib/auth/permissions'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import crypto from 'crypto'
import { logAuditEvent } from '@/lib/audit/logAudit'
import { sendEmail, sendMessage, normalizePhone } from '@/lib/messaging/sendMessage'
import { composeSchoolEmailVerification } from '@/lib/messaging/composeInvite'

const PHONE_OTP_TTL_MINUTES = 10
const PHONE_OTP_MAX_ATTEMPTS = 5
const PHONE_OTP_RESEND_COOLDOWN_SECONDS = 60
// Hard ceiling on top of the cooldown above — caps total SMS sends per
// number so an undeliverable number can't be resent-clicked indefinitely.
const PHONE_OTP_MAX_SENDS_PER_WINDOW = 3
const PHONE_OTP_SEND_WINDOW_HOURS = 24

function hashOtp(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex')
}

async function getContext() {
  // Gated on the 'manage-school-profile' permission (owner/super_admin/is_admin bypass).
  const ctx = await requirePermission('manage-school-profile')
  if (!ctx || !ctx.schoolId) return null
  return { supabase: ctx.supabase, schoolId: ctx.schoolId, userId: ctx.userId }
}

// Base origin for the verification link — built from the incoming request so
// it's correct in dev, preview and prod without an env var (same pattern as
// the Payments settings page's webhook URL).
async function siteOrigin(): Promise<string> {
  const h = await headers()
  const host = h.get('x-forwarded-host') || h.get('host') || 'localhost:3000'
  const proto = h.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}

// Emails a fresh confirm-this-address link to `email` and stamps the
// verification fields — shared by updateSchoolGeneralInfo (on a real change)
// and resendSchoolEmailVerification (an explicit re-send). Best-effort: a
// failed send must never block the save itself, same principle as audit
// logging elsewhere in this codebase.
async function sendSchoolEmailVerification(
  supabase: any, schoolId: string, schoolName: string, email: string
) {
  const token = crypto.randomBytes(32).toString('hex')
  await supabase
    .from('schools')
    .update({ email_verify_token: token, email_verify_sent_at: new Date().toISOString(), email_verified_at: null })
    .eq('id', schoolId)

  const actionUrl = `${await siteOrigin()}/api/verify-school-email?token=${token}`
  await sendEmail(
    { supabase, schoolId, messageType: 'manual' as const },
    email,
    composeSchoolEmailVerification({ schoolName, actionUrl }),
  ).catch(() => {})
}

// Texts a fresh 6-digit code to `phone` and stamps the verification fields —
// shared by updateSchoolGeneralInfo (on a real change), startSchoolPhoneVerification
// (first click on "Verify" for a still-current code) and resendSchoolPhoneVerification
// (an explicit re-send). Only the hash is ever stored, never the code itself.
//
// Enforces PHONE_OTP_MAX_SENDS_PER_WINDOW sends per phone number per rolling
// PHONE_OTP_SEND_WINDOW_HOURS window, counted across all three callers — a
// number that can never be verified shouldn't be able to cost unlimited SMS
// credit. The window resets automatically once it's aged out.
async function sendSchoolPhoneVerification(
  supabase: any, schoolId: string, phone: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: current } = await supabase
    .from('schools')
    .select('phone_verify_send_count, phone_verify_window_started_at')
    .eq('id', schoolId)
    .single()

  const windowStartedAt = current?.phone_verify_window_started_at
    ? new Date(current.phone_verify_window_started_at).getTime()
    : null
  const windowExpired = windowStartedAt === null
    || Date.now() - windowStartedAt > PHONE_OTP_SEND_WINDOW_HOURS * 60 * 60_000
  const sendCount = windowExpired ? 0 : (current?.phone_verify_send_count || 0)

  if (sendCount >= PHONE_OTP_MAX_SENDS_PER_WINDOW) {
    const hoursLeft = Math.ceil(
      (windowStartedAt! + PHONE_OTP_SEND_WINDOW_HOURS * 60 * 60_000 - Date.now()) / (60 * 60_000)
    )
    return {
      ok: false,
      error: `You've reached the limit of ${PHONE_OTP_MAX_SENDS_PER_WINDOW} verification codes for this number in ${PHONE_OTP_SEND_WINDOW_HOURS} hours. Try again in about ${Math.max(hoursLeft, 1)}h, or contact support if the number can't receive texts.`,
    }
  }

  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0')
  await supabase
    .from('schools')
    .update({
      phone_verify_code_hash: hashOtp(code),
      phone_verify_expires_at: new Date(Date.now() + PHONE_OTP_TTL_MINUTES * 60_000).toISOString(),
      phone_verify_sent_at: new Date().toISOString(),
      phone_verify_attempts: 0,
      phone_verified_at: null,
      phone_verify_send_count: sendCount + 1,
      phone_verify_window_started_at: windowExpired ? new Date().toISOString() : current.phone_verify_window_started_at,
    })
    .eq('id', schoolId)

  await sendMessage(
    { supabase, schoolId, messageType: 'phone_verify' as const },
    phone,
    `Your Fees101 verification code is ${code}. It expires in ${PHONE_OTP_TTL_MINUTES} minutes.`,
  ).catch(() => {})

  return { ok: true }
}

export async function updateSchoolGeneralInfo(form: {
  name: string
  smsShortName: string
  proprietressTitle: string
  proprietressFirstName: string
  proprietressLastName: string
  addressStreet: string
  addressCity: string
  addressState: string
  phone: string
  email: string
  reason?: string
}) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx

  if (!form.name.trim()) return { error: 'School name is required' }
  if (form.smsShortName.trim().length > 30) return { error: 'SMS short name must be 30 characters or fewer' }

  const { data: existing } = await supabase
    .from('schools')
    .select('settings, email, phone')
    .eq('id', schoolId)
    .single()

  const nextSettings = {
    ...(existing?.settings || {}),
    smsShortName: form.smsShortName.trim() || null,
  }

  const nextEmail = form.email.trim() || null
  const emailChanged = (existing?.email || null)?.toLowerCase() !== nextEmail?.toLowerCase()

  const nextPhone = form.phone.trim() || null
  const phoneChanged = (existing?.phone ? normalizePhone(existing.phone) : null) !== (nextPhone ? normalizePhone(nextPhone) : null)

  const { error } = await supabase
    .from('schools')
    .update({
      name: form.name.trim(),
      settings: nextSettings,
      proprietress_title: form.proprietressTitle.trim() || null,
      proprietress_first_name: form.proprietressFirstName.trim() || null,
      proprietress_last_name: form.proprietressLastName.trim() || null,
      address_street: form.addressStreet.trim() || null,
      address_city: form.addressCity.trim() || null,
      address_state: form.addressState.trim() || null,
      phone: nextPhone,
      // A changed phone is unverified until the new code is confirmed;
      // clearing it to empty just drops any stale verification state too.
      // The send-count window also resets — a new number gets a fresh budget.
      ...(phoneChanged ? { phone_verified_at: null, phone_verify_code_hash: null, phone_verify_expires_at: null, phone_verify_attempts: 0, phone_verify_sent_at: null, phone_verify_send_count: 0, phone_verify_window_started_at: null } : {}),
      email: nextEmail,
      // A changed email is unverified until the new link is clicked; clearing
      // it to empty just drops any stale verification state along with it.
      ...(emailChanged ? { email_verified_at: null, email_verify_token: null, email_verify_sent_at: null } : {}),
    })
    .eq('id', schoolId)

  if (error) return { error: error.message }

  if (emailChanged && nextEmail) {
    await sendSchoolEmailVerification(supabase, schoolId, form.name.trim(), nextEmail)
  }
  let phoneVerifyError: string | undefined
  if (phoneChanged && nextPhone) {
    const result = await sendSchoolPhoneVerification(supabase, schoolId, nextPhone)
    if (!result.ok) phoneVerifyError = result.error
  }

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'school.updated',
    targetType: 'school',
    targetId: schoolId,
    summary: `Updated school profile for "${form.name.trim()}"`,
    metadata: { name: form.name.trim(), email: form.email.trim() || null, phone: form.phone.trim() || null, reason: form.reason?.trim() || null },
  })

  revalidatePath('/school')
  revalidatePath('/today')
  revalidatePath('/money/invoices')
  return { success: true, phoneVerifyError }
}

const MAX_LOGO_BYTES = 2 * 1024 * 1024
const ALLOWED_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']

export async function uploadSchoolLogo(formData: FormData) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx

  const reason = formData.get('reason')
  const file = formData.get('logo')
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'No file selected' }
  }
  if (!ALLOWED_LOGO_TYPES.includes(file.type)) {
    return { error: 'Logo must be a PNG, JPEG, WebP, or SVG image' }
  }
  if (file.size > MAX_LOGO_BYTES) {
    return { error: 'Logo must be smaller than 2MB' }
  }

  const ext = file.name.split('.').pop() || 'png'
  // Fixed path per school — each new upload overwrites the last, no orphaned files pile up
  const path = `${schoolId}/logo.${ext}`

  const { error: uploadError } = await supabase.storage
    .from('school-logos')
    .upload(path, file, { upsert: true, contentType: file.type })

  if (uploadError) return { error: uploadError.message }

  const { data: publicUrlData } = supabase.storage
    .from('school-logos')
    .getPublicUrl(path)

  // Cache-bust so the new logo shows immediately even though the path is stable
  const logoUrl = `${publicUrlData.publicUrl}?v=${Date.now()}`

  const { error: updateError } = await supabase
    .from('schools')
    .update({ logo_url: logoUrl })
    .eq('id', schoolId)

  if (updateError) return { error: updateError.message }

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'school.logo_uploaded',
    targetType: 'school',
    targetId: schoolId,
    summary: 'Uploaded a new school logo',
    metadata: typeof reason === 'string' && reason.trim() ? { reason: reason.trim() } : undefined,
  })

  revalidatePath('/school')
  revalidatePath('/today')
  revalidatePath('/money/invoices')
  return { success: true, logoUrl }
}

export async function removeSchoolLogo(reason?: string) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx

  const { error } = await supabase
    .from('schools')
    .update({ logo_url: null })
    .eq('id', schoolId)

  if (error) return { error: error.message }

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'school.logo_removed',
    targetType: 'school',
    targetId: schoolId,
    summary: 'Removed the school logo',
    metadata: reason?.trim() ? { reason: reason.trim() } : undefined,
  })

  revalidatePath('/school')
  revalidatePath('/today')
  revalidatePath('/money/invoices')
  return { success: true }
}

// Re-sends the confirm-this-address link without changing the email itself —
// for a school that never clicked the first one, or whose link expired-in-
// spirit (there's no hard expiry check here; a fresh token+send always
// supersedes whatever's pending).
export async function resendSchoolEmailVerification() {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId } = ctx

  const { data: school } = await supabase
    .from('schools')
    .select('name, email')
    .eq('id', schoolId)
    .single()
  if (!school?.email) return { error: 'No email address is set yet.' }

  await sendSchoolEmailVerification(supabase, schoolId, school.name, school.email)

  revalidatePath('/school')
  return { success: true }
}

// Called when the office phone row's "Verify" button is clicked. Sends a
// fresh code only if there's no still-live one already pending — clicking
// Verify again while a code from moments ago is still valid (e.g. the drawer
// was closed and reopened) shouldn't cost a second SMS.
export async function startSchoolPhoneVerification() {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId } = ctx

  const { data: school } = await supabase
    .from('schools')
    .select('phone, phone_verify_expires_at')
    .eq('id', schoolId)
    .single()
  if (!school?.phone) return { error: 'Add a phone number first.' }

  const stillValid = school.phone_verify_expires_at && new Date(school.phone_verify_expires_at).getTime() > Date.now()
  if (!stillValid) {
    const result = await sendSchoolPhoneVerification(supabase, schoolId, school.phone)
    if (!result.ok) return { error: result.error }
  }

  revalidatePath('/school')
  return { success: true }
}

// Explicit re-send from inside the code-entry drawer — cooldown-gated so
// impatient repeat clicks don't burn SMS credit, unlike startSchoolPhoneVerification
// above (which only sends when nothing is pending at all).
export async function resendSchoolPhoneVerification() {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId } = ctx

  const { data: school } = await supabase
    .from('schools')
    .select('phone, phone_verify_sent_at')
    .eq('id', schoolId)
    .single()
  if (!school?.phone) return { error: 'Add a phone number first.' }

  if (school.phone_verify_sent_at) {
    const secondsSince = (Date.now() - new Date(school.phone_verify_sent_at).getTime()) / 1000
    if (secondsSince < PHONE_OTP_RESEND_COOLDOWN_SECONDS) {
      return { error: `Wait ${Math.ceil(PHONE_OTP_RESEND_COOLDOWN_SECONDS - secondsSince)}s before requesting another code.` }
    }
  }

  const result = await sendSchoolPhoneVerification(supabase, schoolId, school.phone)
  if (!result.ok) return { error: result.error }
  revalidatePath('/school')
  return { success: true }
}

export async function verifySchoolPhoneOtp(code: string) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx

  const trimmed = code.trim()
  if (!trimmed) return { error: 'Enter the code sent to your phone.' }

  const { data: school } = await supabase
    .from('schools')
    .select('phone, phone_verify_code_hash, phone_verify_expires_at, phone_verify_attempts')
    .eq('id', schoolId)
    .single()

  if (!school?.phone_verify_code_hash || !school.phone_verify_expires_at) {
    return { error: 'No code is pending. Request a new one.' }
  }
  if (new Date(school.phone_verify_expires_at).getTime() < Date.now()) {
    return { error: 'That code has expired. Request a new one.' }
  }
  if ((school.phone_verify_attempts || 0) >= PHONE_OTP_MAX_ATTEMPTS) {
    return { error: 'Too many incorrect attempts. Request a new code.' }
  }

  if (hashOtp(trimmed) !== school.phone_verify_code_hash) {
    const attempts = (school.phone_verify_attempts || 0) + 1
    await supabase.from('schools').update({ phone_verify_attempts: attempts }).eq('id', schoolId)
    const remaining = PHONE_OTP_MAX_ATTEMPTS - attempts
    return {
      error: remaining > 0
        ? `Incorrect code — ${remaining} attempt${remaining === 1 ? '' : 's'} left.`
        : 'Too many incorrect attempts. Request a new code.',
    }
  }

  await supabase
    .from('schools')
    .update({
      phone_verified_at: new Date().toISOString(),
      phone_verify_code_hash: null,
      phone_verify_expires_at: null,
      phone_verify_attempts: 0,
    })
    .eq('id', schoolId)

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'school.phone_verified',
    targetType: 'school',
    targetId: schoolId,
    summary: `Confirmed the office phone number (${school.phone})`,
  })

  revalidatePath('/school')
  return { success: true }
}
