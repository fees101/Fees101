'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { SchoolSettings } from '@/lib/queries/school'
import { updateSchoolGeneralInfo, uploadSchoolLogo, removeSchoolLogo, resendSchoolEmailVerification, startSchoolPhoneVerification, verifySchoolPhoneOtp, resendSchoolPhoneVerification } from '@/app/(app)/school/actions'
import FieldEditDrawer, { SectionLabel } from '@/components/settings/FieldEditDrawer'
import Toast from '@/components/ui/Toast'

interface Props {
  school: SchoolSettings
  actorName: string
  // ?emailVerify= from the confirm-link redirect (/api/verify-school-email) —
  // 'ok' | 'invalid' | 'missing' | undefined. One-shot: shown once, then the
  // query param is stripped so a refresh doesn't repeat the toast.
  emailVerifyResult?: string
}

const COUNTRY_CODES = [
  { code: '+234', label: 'Nigeria (+234)' },
  { code: '+233', label: 'Ghana (+233)' },
  { code: '+254', label: 'Kenya (+254)' },
  { code: '+256', label: 'Uganda (+256)' },
  { code: '+27', label: 'South Africa (+27)' },
  { code: '+1', label: 'US / Canada (+1)' },
  { code: '+44', label: 'United Kingdom (+44)' },
  { code: '+91', label: 'India (+91)' },
]

const NIGERIAN_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno',
  'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT', 'Gombe', 'Imo',
  'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa',
  'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara',
]

const MAX_LOGO_BYTES = 2 * 1024 * 1024

function splitPhone(phone: string | null): { code: string, number: string } {
  if (phone) {
    const sorted = [...COUNTRY_CODES].sort((a, b) => b.code.length - a.code.length)
    for (const { code } of sorted) {
      if (phone.startsWith(code)) return { code, number: phone.slice(code.length).trim() }
    }
    return { code: '+234', number: phone.replace(/^\+/, '') }
  }
  return { code: '+234', number: '' }
}

function getSchoolInitials(name: string): string {
  const words = name.split(/\s+/).filter(w => w.length > 0)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

type Values = {
  name: string
  smsShortName: string
  addressStreet: string
  addressCity: string
  addressState: string
  phoneCode: string
  phoneNumber: string
  email: string
  proprietressTitle: string
  proprietressFirstName: string
  proprietressLastName: string
}

// Keys of the rows that open the edit drawer. Logo has its own drawer body.
type RowKey = 'name' | 'address' | 'phone' | 'sms' | 'email' | 'proprietress' | 'logo'

const ROW_LABELS: Record<RowKey, string> = {
  name: 'School name',
  address: 'Address',
  phone: 'Office phone',
  sms: 'SMS sender name',
  email: 'Email address',
  proprietress: 'Proprietress / Owner name',
  logo: 'Logo',
}

export default function SchoolProfileForm({ school, actorName, emailVerifyResult }: Props) {
  const router = useRouter()
  const initialPhone = splitPhone(school.phone)
  const inputRef = useRef<HTMLInputElement>(null)

  const initial: Values = {
    name: school.name,
    smsShortName: school.smsShortName || '',
    addressStreet: school.addressStreet || '',
    addressCity: school.addressCity || '',
    addressState: school.addressState || '',
    phoneCode: initialPhone.code,
    phoneNumber: initialPhone.number,
    email: school.email || '',
    proprietressTitle: school.proprietressTitle || '',
    proprietressFirstName: school.proprietressFirstName || '',
    proprietressLastName: school.proprietressLastName || '',
  }

  const [values, setValues] = useState<Values>(initial)
  const [draft, setDraft] = useState<Values>(initial)
  const [editing, setEditing] = useState<RowKey | null>(null)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [logoUrl, setLogoUrl] = useState(school.logoUrl)
  const [dragOver, setDragOver] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [logoError, setLogoError] = useState<string | null>(null)
  const [confirmRemoveLogo, setConfirmRemoveLogo] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const [emailVerifiedAt, setEmailVerifiedAt] = useState(school.emailVerifiedAt)
  const [resendingVerification, setResendingVerification] = useState(false)
  const [emailNotice, setEmailNotice] = useState<{ ok: boolean; message: string } | null>(null)

  const [phoneVerifiedAt, setPhoneVerifiedAt] = useState(school.phoneVerifiedAt)
  const [startingPhoneVerify, setStartingPhoneVerify] = useState(false)
  const [otpOpen, setOtpOpen] = useState(false)
  const [otpCode, setOtpCode] = useState('')
  const [otpError, setOtpError] = useState<string | null>(null)
  const [verifyingOtp, setVerifyingOtp] = useState(false)
  const [resendingPhoneOtp, setResendingPhoneOtp] = useState(false)
  const [phoneNotice, setPhoneNotice] = useState<{ ok: boolean; message: string } | null>(null)

  // One-shot toast for the confirm-link redirect, then scrub the query param
  // so refreshing the page doesn't replay it.
  useEffect(() => {
    if (!emailVerifyResult) return
    if (emailVerifyResult === 'ok') {
      setEmailVerifiedAt(new Date().toISOString())
      setEmailNotice({ ok: true, message: 'Email address confirmed.' })
    } else {
      setEmailNotice({ ok: false, message: 'That confirmation link is no longer valid — send a new one.' })
    }
    router.replace('/school')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function resendVerification() {
    setResendingVerification(true)
    const result = await resendSchoolEmailVerification()
    setResendingVerification(false)
    if (result.error) {
      setEmailNotice({ ok: false, message: result.error })
      return
    }
    setEmailNotice({ ok: true, message: 'Verification email sent.' })
  }

  async function openPhoneVerify() {
    setStartingPhoneVerify(true)
    const result = await startSchoolPhoneVerification()
    setStartingPhoneVerify(false)
    if (result.error) {
      setPhoneNotice({ ok: false, message: result.error })
      return
    }
    setOtpCode('')
    setOtpError(null)
    setOtpOpen(true)
  }

  async function submitPhoneOtp() {
    setOtpError(null)
    setVerifyingOtp(true)
    const result = await verifySchoolPhoneOtp(otpCode)
    setVerifyingOtp(false)
    if (result.error) {
      setOtpError(result.error)
      return
    }
    setPhoneVerifiedAt(new Date().toISOString())
    setOtpOpen(false)
    setPhoneNotice({ ok: true, message: 'Phone number confirmed.' })
  }

  async function resendPhoneOtp() {
    setResendingPhoneOtp(true)
    const result = await resendSchoolPhoneVerification()
    setResendingPhoneOtp(false)
    if (result.error) {
      setOtpError(result.error)
      return
    }
    setOtpError(null)
  }

  const initials = getSchoolInitials(values.name || school.name)

  function openEdit(key: RowKey) {
    setDraft(values)
    setReason('')
    setError(null)
    setLogoError(null)
    setConfirmRemoveLogo(false)
    setEditing(key)
  }

  function closeEdit() {
    setEditing(null)
    setConfirmRemoveLogo(false)
  }

  function updateDraft<K extends keyof Values>(key: K, value: Values[K]) {
    setDraft(d => ({ ...d, [key]: value }))
  }

  async function saveRow() {
    setSaving(true)
    setError(null)
    const result = await updateSchoolGeneralInfo({
      name: draft.name,
      smsShortName: draft.smsShortName,
      proprietressTitle: draft.proprietressTitle,
      proprietressFirstName: draft.proprietressFirstName,
      proprietressLastName: draft.proprietressLastName,
      addressStreet: draft.addressStreet,
      addressCity: draft.addressCity,
      addressState: draft.addressState,
      phone: draft.phoneNumber.trim() ? `${draft.phoneCode}${draft.phoneNumber.trim()}` : '',
      email: draft.email,
      reason: reason.trim() || undefined,
    })
    setSaving(false)
    if (result.error) {
      setError(result.error)
      return
    }
    // A changed email always comes back unverified — a fresh confirm link
    // was just sent to it (updateSchoolGeneralInfo), so reflect that locally
    // rather than waiting on a full page reload.
    if (draft.email.trim().toLowerCase() !== values.email.trim().toLowerCase()) {
      setEmailVerifiedAt(null)
    }
    // Same idea for phone, but since there's no link to click, open the code
    // entry right away — the SMS was already sent as part of this same save.
    // Unless the send hit the resend-limit cap (result.phoneVerifyError): then
    // there's no code pending, so surface that instead of opening a dead drawer.
    if (`${draft.phoneCode}${draft.phoneNumber.trim()}` !== `${values.phoneCode}${values.phoneNumber.trim()}`) {
      setPhoneVerifiedAt(null)
      if (draft.phoneNumber.trim()) {
        if (result.phoneVerifyError) {
          setPhoneNotice({ ok: false, message: result.phoneVerifyError })
        } else {
          setOtpCode('')
          setOtpError(null)
          setOtpOpen(true)
        }
      }
    }
    setValues(draft)
    setSaved(editing ? ROW_LABELS[editing] : null)
    setEditing(null)
  }

  async function handleLogoFile(file: File | undefined) {
    if (!file) return
    setLogoError(null)
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(file.type)) {
      setLogoError('Logo must be a PNG, JPEG, WebP, or SVG image')
      return
    }
    if (file.size > MAX_LOGO_BYTES) {
      setLogoError('Logo must be smaller than 2MB')
      return
    }
    setUploadingLogo(true)
    try {
      const formData = new FormData()
      formData.append('logo', file)
      if (reason.trim()) formData.append('reason', reason.trim())
      const result = await uploadSchoolLogo(formData)
      if (result.error) {
        setLogoError(result.error)
        return
      }
      setLogoUrl(result.logoUrl!)
      setSaved(ROW_LABELS.logo)
    } catch {
      setLogoError('Upload failed. Check your connection and try again.')
    } finally {
      setUploadingLogo(false)
    }
  }

  async function handleRemoveLogo() {
    const result = await removeSchoolLogo(reason.trim() || undefined)
    setConfirmRemoveLogo(false)
    if (result.error) {
      setLogoError(result.error)
      return
    }
    setLogoUrl(null)
    setSaved(ROW_LABELS.logo)
  }

  const addressDisplay = [values.addressStreet, values.addressCity, values.addressState].filter(Boolean).join(', ')
  const phoneDisplay = values.phoneNumber.trim() ? `${values.phoneCode} ${values.phoneNumber}` : ''
  const proprietressDisplay = [values.proprietressTitle, values.proprietressFirstName, values.proprietressLastName].filter(Boolean).join(' ')

  return (
    <>
      <div style={{ borderTop: '2px solid var(--color-ink)', paddingTop: 18 }}>
        <h2 className="text-2xl font-extrabold tracking-[-0.015em] text-[var(--color-ink)]" style={{ margin: 0 }}>
          School profile
        </h2>
        <p className="text-[13px] text-[var(--color-neutral-800)]" style={{ maxWidth: '74ch', marginTop: 8 }}>
          What appears on every invoice, receipt and message a parent receives.
        </p>
      </div>

      <div style={{ marginTop: 8 }}>
        <SettingRow
          label="School name"
          desc="Shown as the sender on all messages"
          value={values.name || 'Not set'}
          action="EDIT"
          onAction={() => openEdit('name')}
        />

        <SettingRow
          label="Logo"
          desc="Used on invoice and receipt PDFs. Falls back to initials."
          value={logoUrl ? 'Uploaded' : `Using initials (${initials})`}
          action="REPLACE"
          onAction={() => openEdit('logo')}
        />

        <SettingRow
          label="Address"
          desc="Printed on the invoice header"
          value={addressDisplay || 'Not set'}
          action="EDIT"
          onAction={() => openEdit('address')}
        />

        <SettingRow
          label="Office phone"
          desc="Given to parents as the contact for questions"
          value={
            phoneDisplay ? (
              <>
                {phoneDisplay}{' '}
                {phoneVerifiedAt ? (
                  <span style={{ color: 'var(--color-ink)', fontSize: 13, fontWeight: 600 }}>· Verified</span>
                ) : (
                  <span style={{ color: 'var(--color-ochre-text)', fontSize: 13, fontWeight: 600 }}>
                    · Verification pending{' '}
                    <button
                      type="button"
                      onClick={openPhoneVerify}
                      disabled={startingPhoneVerify}
                      style={{ fontWeight: 700, textDecoration: 'underline', textUnderlineOffset: 2 }}
                    >
                      {startingPhoneVerify ? 'Sending…' : 'Verify'}
                    </button>
                  </span>
                )}
              </>
            ) : (
              'Not set'
            )
          }
          action="EDIT"
          onAction={() => openEdit('phone')}
        />

        {phoneNotice && (
          <Toast
            title={phoneNotice.ok ? 'Phone' : undefined}
            message={phoneNotice.message}
            ok={phoneNotice.ok}
            onDismiss={() => setPhoneNotice(null)}
          />
        )}

        <SettingRow
          label="SMS sender name"
          desc="Max 11 characters, shown as the SMS sender"
          value={values.smsShortName || 'Uses the full school name'}
          action="EDIT"
          onAction={() => openEdit('sms')}
        />

        <SettingRow
          label="Email address"
          desc="How Fees101 reaches the school, and given to parents if needed"
          value={
            values.email ? (
              <>
                {values.email}{' '}
                {emailVerifiedAt ? (
                  <span style={{ color: 'var(--color-ink)', fontSize: 13, fontWeight: 600 }}>· Verified</span>
                ) : (
                  <span style={{ color: 'var(--color-ochre-text)', fontSize: 13, fontWeight: 600 }}>
                    · Verification pending{' '}
                    <button
                      type="button"
                      onClick={resendVerification}
                      disabled={resendingVerification}
                      style={{ fontWeight: 700, textDecoration: 'underline', textUnderlineOffset: 2 }}
                    >
                      {resendingVerification ? 'Sending…' : 'Resend'}
                    </button>
                  </span>
                )}
              </>
            ) : (
              'Not set'
            )
          }
          action="EDIT"
          onAction={() => openEdit('email')}
        />

        {emailNotice && (
          <Toast
            title={emailNotice.ok ? 'Email' : undefined}
            message={emailNotice.message}
            ok={emailNotice.ok}
            onDismiss={() => setEmailNotice(null)}
          />
        )}

        <SettingRow
          label="Proprietress / Owner name"
          desc="Shown on official documents where a signatory is named"
          value={proprietressDisplay || 'Not set'}
          action="EDIT"
          onAction={() => openEdit('proprietress')}
        />

        {/* Currency and locale is fixed to NGN / en-NG app-wide today — shown for
            transparency, not editable. */}
        <SettingRow
          label="Currency and locale"
          desc="Affects formatting everywhere"
          value="NGN · en-NG"
          action="FIXED"
        />
      </div>

      {editing === 'name' && (
        <FieldEditDrawer
          title="School name"
          subtitle="Shown as the sender on all messages"
          currentDisplay={values.name || 'Not set'}
          note="Appears at the top of every invoice, receipt and parent message."
          reason={reason}
          onReasonChange={setReason}
          actorName={actorName}
          onClose={closeEdit}
          onSave={saveRow}
          saving={saving}
          error={error}
        >
          <div style={{ marginBottom: 16 }}>
            <SectionLabel>New value</SectionLabel>
            <input
              type="text"
              value={draft.name}
              onChange={e => updateDraft('name', e.target.value)}
              className="m-input"
              style={{ width: '100%', boxSizing: 'border-box' }}
              autoFocus
            />
          </div>
        </FieldEditDrawer>
      )}

      {editing === 'logo' && (
        <FieldEditDrawer
          title="Logo"
          subtitle="Used on invoice and receipt PDFs. Falls back to initials."
          currentDisplay={logoUrl ? 'Uploaded' : `Using initials (${initials})`}
          note="Square, at least 512px. Appears on invoices, receipts and the parent portal. Printed in black and white on PDFs — check it still reads."
          reason={reason}
          onReasonChange={setReason}
          actorName={actorName}
          onClose={closeEdit}
          onSave={closeEdit}
          saveLabel="Done"
          saving={uploadingLogo}
          error={logoError}
        >
          <div style={{ marginBottom: 16 }}>
            <SectionLabel>New logo</SectionLabel>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); handleLogoFile(e.dataTransfer.files?.[0]) }}
              style={{
                border: `2px dashed ${dragOver ? 'var(--color-signal)' : 'var(--color-ink)'}`,
                background: dragOver ? 'var(--color-signal-100)' : 'var(--color-paper)',
                padding: '24px 18px',
                textAlign: 'left',
              }}
            >
              <input
                ref={inputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="hidden"
                onChange={(e) => handleLogoFile(e.target.files?.[0])}
              />
              <p className="text-[14px] font-semibold text-[var(--color-ink)]" style={{ margin: '0 0 4px' }}>Drop an image here</p>
              <p className="text-[12px]" style={{ margin: '0 0 14px', color: 'var(--color-neutral-700)' }}>PNG or SVG · square · at least 512px</p>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={uploadingLogo}
                className="m-btn m-btn-outline m-btn-sm"
              >
                {uploadingLogo ? 'Uploading...' : 'Choose a file'}
              </button>
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <SectionLabel>How it will print</SectionLabel>
            <div className="flex items-center gap-3">
              <div
                style={{ width: 56, height: 56, background: 'var(--color-surface)', border: '1px solid var(--color-neutral-300)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}
              >
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoUrl} alt={values.name} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-[var(--color-ink)] font-extrabold text-[13px]">{initials}</span>
                )}
              </div>
              <div
                style={{ width: 56, height: 56, background: 'var(--color-ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}
              >
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoUrl} alt="" className="w-full h-full object-cover" style={{ filter: 'grayscale(1) contrast(1.3) brightness(1.6)' }} />
                ) : (
                  <span className="font-extrabold text-[13px]" style={{ color: 'var(--color-neutral-500)' }}>{initials}</span>
                )}
              </div>
              <p className="text-[12px] leading-relaxed" style={{ margin: 0, color: 'var(--color-neutral-700)' }}>
                Invoices print black and white. A logo that relies on colour disappears.
              </p>
            </div>
          </div>

          {logoUrl && !confirmRemoveLogo && (
            <button
              onClick={() => setConfirmRemoveLogo(true)}
              className="text-[12px] font-semibold text-[var(--color-signal-text)] hover:underline"
              style={{ marginBottom: 16, display: 'block' }}
            >
              Remove logo
            </button>
          )}
          {confirmRemoveLogo && (
            <div style={{ borderLeft: '2px solid var(--color-ink)', padding: '12px 0 2px 14px', marginBottom: 16 }}>
              <p className="text-[13px]" style={{ color: 'var(--color-ink)', marginBottom: 10 }}>
                Invoices and PDFs will fall back to showing the school&apos;s initials instead.
              </p>
              <div className="flex items-center gap-3">
                <button onClick={handleRemoveLogo} className="m-btn m-btn-danger m-btn-sm">Remove</button>
                <button onClick={() => setConfirmRemoveLogo(false)} className="text-[13px] font-semibold hover:underline" style={{ color: 'var(--color-ink)' }}>Cancel</button>
              </div>
            </div>
          )}
        </FieldEditDrawer>
      )}

      {editing === 'address' && (
        <FieldEditDrawer
          title="Address"
          subtitle="Printed on the invoice header"
          currentDisplay={addressDisplay || 'Not set'}
          note="Printed in the header of invoices and receipts."
          reason={reason}
          onReasonChange={setReason}
          actorName={actorName}
          onClose={closeEdit}
          onSave={saveRow}
          saving={saving}
          error={error}
        >
          <div style={{ marginBottom: 16 }}>
            <SectionLabel>New address</SectionLabel>
            <input
              type="text"
              value={draft.addressStreet}
              onChange={e => updateDraft('addressStreet', e.target.value)}
              placeholder="Street"
              className="m-input"
              style={{ width: '100%', boxSizing: 'border-box', marginBottom: 8 }}
              autoFocus
            />
            <div className="grid grid-cols-2 gap-2">
              <input type="text" value={draft.addressCity} onChange={e => updateDraft('addressCity', e.target.value)} placeholder="City" className="m-input" />
              <select value={draft.addressState} onChange={e => updateDraft('addressState', e.target.value)} className="m-select">
                <option value="">State</option>
                {NIGERIAN_STATES.map(state => (
                  <option key={state} value={state}>{state === 'FCT' ? 'FCT (Abuja)' : state}</option>
                ))}
              </select>
            </div>
          </div>
        </FieldEditDrawer>
      )}

      {editing === 'phone' && (
        <FieldEditDrawer
          title="Office phone"
          subtitle="Given to parents as the contact for questions"
          currentDisplay={phoneDisplay || 'Not set'}
          reason={reason}
          onReasonChange={setReason}
          actorName={actorName}
          onClose={closeEdit}
          onSave={saveRow}
          saving={saving}
          error={error}
          note="Changing this texts a 6-digit code to the new number to confirm it's live — you'll be asked for it right after saving."
        >
          <div style={{ marginBottom: 16 }}>
            <SectionLabel>New value</SectionLabel>
            <div className="flex gap-2">
              <select value={draft.phoneCode} onChange={e => updateDraft('phoneCode', e.target.value)} className="m-select flex-shrink-0 w-[92px]">
                {COUNTRY_CODES.map(({ code }) => <option key={code} value={code}>{code}</option>)}
              </select>
              <input
                type="tel"
                value={draft.phoneNumber}
                onChange={e => updateDraft('phoneNumber', e.target.value.replace(/\D/g, ''))}
                placeholder="8023174622"
                className="m-input flex-1 min-w-0"
                autoFocus
              />
            </div>
          </div>
        </FieldEditDrawer>
      )}

      {otpOpen && (
        <div className="fixed inset-0 z-50 flex m-anim-fade">
          <div className="flex-1 bg-[color-mix(in_srgb,var(--color-ink)_45%,transparent)]" onClick={() => setOtpOpen(false)} />
          <aside
            style={{ width: '420px', maxWidth: '100%' }}
            className="h-full overflow-y-auto bg-[var(--color-paper)] border-l-2 border-[var(--color-ink)] p-[22px] m-anim-slide"
          >
            <div className="flex items-baseline justify-between gap-3 mb-1">
              <h2 className="text-[22px] font-extrabold tracking-[-0.01em] text-[var(--color-ink)]">Confirm phone number</h2>
              <button
                onClick={() => setOtpOpen(false)}
                aria-label="Close"
                className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--color-signal-text)] hover:underline"
              >
                Close
              </button>
            </div>
            <p className="text-[13px] leading-relaxed mb-5 text-[var(--color-neutral-700)]">
              We sent a 6-digit code to {phoneDisplay}.
            </p>

            <div style={{ borderTop: '2px solid var(--color-ink)', paddingTop: 16 }}>
              <div style={{ marginBottom: 16 }}>
                <SectionLabel>Code</SectionLabel>
                <input
                  type="text"
                  inputMode="numeric"
                  value={otpCode}
                  onChange={e => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="123456"
                  className="m-input m-num"
                  style={{ width: '100%', boxSizing: 'border-box', letterSpacing: '0.2em' }}
                  autoFocus
                />
              </div>

              <p className="text-[12px] leading-relaxed text-[var(--color-neutral-700)]" style={{ marginBottom: 16 }}>
                Didn&apos;t get it?{' '}
                <button
                  type="button"
                  onClick={resendPhoneOtp}
                  disabled={resendingPhoneOtp}
                  style={{ fontWeight: 700, textDecoration: 'underline', textUnderlineOffset: 2, color: 'var(--color-ink)' }}
                >
                  {resendingPhoneOtp ? 'Sending…' : 'Resend code'}
                </button>
              </p>

              {otpError && (
                <div className="mb-4 p-3 text-sm text-[var(--color-signal-text)]" style={{ borderLeft: '3px solid var(--color-signal)' }}>
                  {otpError}
                </div>
              )}

              <div className="flex items-center gap-[10px]">
                <button onClick={submitPhoneOtp} disabled={verifyingOtp || otpCode.length !== 6} className="m-btn m-btn-primary" style={{ flex: 1 }}>
                  {verifyingOtp ? 'Verifying...' : 'Verify code'}
                </button>
                <button onClick={() => setOtpOpen(false)} disabled={verifyingOtp} className="m-btn m-btn-outline">Cancel</button>
              </div>
            </div>
          </aside>
        </div>
      )}

      {editing === 'sms' && (
        <FieldEditDrawer
          title="SMS sender name"
          subtitle="Max 11 characters, shown as the SMS sender"
          currentDisplay={values.smsShortName || 'Uses the full school name'}
          reason={reason}
          onReasonChange={setReason}
          actorName={actorName}
          onClose={closeEdit}
          onSave={saveRow}
          saving={saving}
          error={error}
        >
          <div style={{ marginBottom: 16 }}>
            <SectionLabel>New value</SectionLabel>
            <input
              type="text"
              value={draft.smsShortName}
              onChange={e => updateDraft('smsShortName', e.target.value.slice(0, 11))}
              placeholder={initials}
              className="m-input"
              style={{ width: '100%', boxSizing: 'border-box' }}
              autoFocus
            />
          </div>
        </FieldEditDrawer>
      )}

      {editing === 'email' && (
        <FieldEditDrawer
          title="Email address"
          subtitle="How Fees101 reaches the school, and given to parents if needed"
          currentDisplay={values.email || 'Not set'}
          reason={reason}
          onReasonChange={setReason}
          actorName={actorName}
          onClose={closeEdit}
          onSave={saveRow}
          saving={saving}
          error={error}
          note="Changing this sends a confirmation link to the new address — it won't show as verified until that link is opened."
        >
          <div style={{ marginBottom: 16 }}>
            <SectionLabel>New value</SectionLabel>
            <input
              type="email"
              value={draft.email}
              onChange={e => updateDraft('email', e.target.value)}
              placeholder="school@example.com"
              className="m-input"
              style={{ width: '100%', boxSizing: 'border-box' }}
              autoFocus
            />
          </div>
        </FieldEditDrawer>
      )}

      {editing === 'proprietress' && (
        <FieldEditDrawer
          title="Proprietress / Owner name"
          subtitle="Shown on official documents where a signatory is named"
          currentDisplay={proprietressDisplay || 'Not set'}
          reason={reason}
          onReasonChange={setReason}
          actorName={actorName}
          onClose={closeEdit}
          onSave={saveRow}
          saving={saving}
          error={error}
        >
          <div style={{ marginBottom: 16 }}>
            <SectionLabel>New value</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr', gap: 8 }}>
              <input type="text" value={draft.proprietressTitle} onChange={e => updateDraft('proprietressTitle', e.target.value)} placeholder="Title" className="m-input" autoFocus />
              <input type="text" value={draft.proprietressFirstName} onChange={e => updateDraft('proprietressFirstName', e.target.value)} placeholder="First name" className="m-input" />
              <input type="text" value={draft.proprietressLastName} onChange={e => updateDraft('proprietressLastName', e.target.value)} placeholder="Last name" className="m-input" />
            </div>
          </div>
        </FieldEditDrawer>
      )}
      {saved && (
        <Toast
          title="Change saved"
          message={`${saved} — recorded in the audit log.`}
          ok
          onDismiss={() => setSaved(null)}
        />
      )}
    </>
  )
}

// One ruled setting row: label + description (left), current value (centre),
// and an action word flush right. EDIT/REPLACE open the field's edit drawer;
// FIXED is inert.
function SettingRow({
  label, desc, value, action, onAction,
}: {
  label: string
  desc: string
  value: React.ReactNode
  action: 'EDIT' | 'REPLACE' | 'FIXED'
  onAction?: () => void
}) {
  return (
    <div className="m-setrow">
      <div style={{ minWidth: 0 }}>
        <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-ink)', margin: 0 }}>{label}</p>
        <p className="text-[13px] text-[var(--color-neutral-700)]" style={{ margin: '4px 0 0' }}>{desc}</p>
      </div>
      <div className="m-setrow__side">
        <p className="text-[15px] text-[var(--color-ink)]" style={{ margin: 0, minWidth: 0, wordBreak: 'break-word' }}>{value}</p>
        {action === 'FIXED' ? (
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--color-neutral-500)', whiteSpace: 'nowrap' }}>FIXED</span>
        ) : (
          <button onClick={onAction} style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--color-ink)', whiteSpace: 'nowrap' }} className="hover:text-[var(--color-signal-text)]">
            {action}
          </button>
        )}
      </div>
    </div>
  )
}
