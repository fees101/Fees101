'use client'

import { useRef, useState } from 'react'
import { SchoolSettings } from '@/lib/queries/school'
import { updateSchoolGeneralInfo, uploadSchoolLogo, removeSchoolLogo } from '@/app/(app)/settings/actions'
import ConfirmDialog from '@/components/ConfirmDialog'

interface Props {
  school: SchoolSettings
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

export default function SchoolProfileForm({ school }: Props) {
  const initialPhone = splitPhone(school.phone)
  const inputRef = useRef<HTMLInputElement>(null)

  const [logoUrl, setLogoUrl] = useState(school.logoUrl)
  const [dragOver, setDragOver] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [logoError, setLogoError] = useState<string | null>(null)
  const [confirmRemoveLogo, setConfirmRemoveLogo] = useState(false)

  const initial = {
    name: school.name,
    proprietressTitle: school.proprietressTitle || '',
    proprietressFirstName: school.proprietressFirstName || '',
    proprietressLastName: school.proprietressLastName || '',
    addressStreet: school.addressStreet || '',
    addressCity: school.addressCity || '',
    addressState: school.addressState || '',
    phoneCode: initialPhone.code,
    phoneNumber: initialPhone.number,
    email: school.email || '',
  }
  const [form, setForm] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const initials = getSchoolInitials(school.name)

  function update<K extends keyof typeof form>(key: K, value: typeof form[K]) {
    setForm(f => ({ ...f, [key]: value }))
    setSaved(false)
  }

  function handleCancel() {
    setForm(initial)
    setError(null)
    setSaved(false)
  }

  async function handleSave() {
    setError(null)
    setSaved(false)
    setSaving(true)
    const result = await updateSchoolGeneralInfo({
      name: form.name,
      proprietressTitle: form.proprietressTitle,
      proprietressFirstName: form.proprietressFirstName,
      proprietressLastName: form.proprietressLastName,
      addressStreet: form.addressStreet,
      addressCity: form.addressCity,
      addressState: form.addressState,
      phone: form.phoneNumber.trim() ? `${form.phoneCode}${form.phoneNumber.trim()}` : '',
      email: form.email,
    })
    setSaving(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setSaved(true)
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
    const formData = new FormData()
    formData.append('logo', file)
    const result = await uploadSchoolLogo(formData)
    setUploadingLogo(false)
    if (result.error) {
      setLogoError(result.error)
      return
    }
    setLogoUrl(result.logoUrl!)
  }

  async function handleRemoveLogo() {
    const result = await removeSchoolLogo()
    setConfirmRemoveLogo(false)
    if (result.error) {
      setLogoError(result.error)
      return
    }
    setLogoUrl(null)
  }

  const inputCls = "w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40"
  const labelCls = "block text-xs text-gray-500 mb-1"

  return (
    <>
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
        <h2 className="text-navy font-semibold text-lg mb-1">School profile</h2>
        <p className="text-sm text-gray-500 mb-6">Update your school&apos;s information and contact details.</p>

        <div className="grid grid-cols-1 sm:grid-cols-[9rem_1fr] gap-6">
          {/* Logo */}
          <div className="flex sm:flex-col items-center sm:items-start gap-4 sm:gap-2">
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); handleLogoFile(e.dataTransfer.files?.[0]) }}
              onClick={() => inputRef.current?.click()}
              className={`w-28 h-28 sm:w-36 sm:h-36 rounded-2xl border-2 border-dashed flex items-center justify-center overflow-hidden cursor-pointer transition-colors flex-shrink-0 ${
                dragOver ? 'border-mint bg-mint-light/40' : 'border-gray-200 bg-mint-light hover:border-mint/50'
              }`}
            >
              <input
                ref={inputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="hidden"
                onChange={(e) => handleLogoFile(e.target.files?.[0])}
              />
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt={school.name} className="w-full h-full object-cover" />
              ) : (
                <span className="text-navy font-bold text-2xl">{initials}</span>
              )}
            </div>
            <div className="min-w-0">
              <button
                onClick={() => inputRef.current?.click()}
                disabled={uploadingLogo}
                className="px-3 py-1.5 border border-gray-200 text-navy text-xs font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                {uploadingLogo ? 'Uploading...' : 'Change logo'}
              </button>
              <p className="text-xs text-gray-400 mt-1.5">JPG, PNG or SVG. Max 2MB.</p>
              {logoUrl && (
                <button
                  onClick={() => setConfirmRemoveLogo(true)}
                  className="text-xs text-red-600 hover:underline mt-1.5 block"
                >
                  Remove logo
                </button>
              )}
              {logoError && <p className="text-xs text-red-600 mt-1.5">{logoError}</p>}
            </div>
          </div>

          {/* Fields */}
          <div className="space-y-5 min-w-0">
            <div>
              <label className={labelCls}>School name *</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => update('name', e.target.value)}
                className={inputCls}
              />
            </div>

            <div>
              <label className={labelCls}>School address *</label>
              <input
                type="text"
                value={form.addressStreet}
                onChange={(e) => update('addressStreet', e.target.value)}
                placeholder="Street"
                className={inputCls}
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                <input
                  type="text"
                  value={form.addressCity}
                  onChange={(e) => update('addressCity', e.target.value)}
                  placeholder="City"
                  className={inputCls}
                />
                <select
                  value={form.addressState}
                  onChange={(e) => update('addressState', e.target.value)}
                  className={inputCls}
                >
                  <option value="">State</option>
                  {NIGERIAN_STATES.map(state => (
                    <option key={state} value={state}>{state === 'FCT' ? 'FCT (Abuja)' : state}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Phone number *</label>
                <div className="flex gap-2">
                  <select
                    value={form.phoneCode}
                    onChange={(e) => update('phoneCode', e.target.value)}
                    className="px-2 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40 flex-shrink-0 w-[84px]"
                  >
                    {COUNTRY_CODES.map(({ code }) => (
                      <option key={code} value={code}>{code}</option>
                    ))}
                  </select>
                  <input
                    type="tel"
                    value={form.phoneNumber}
                    onChange={(e) => update('phoneNumber', e.target.value.replace(/\D/g, ''))}
                    placeholder="8023174622"
                    className={`${inputCls} flex-1 min-w-0`}
                  />
                </div>
              </div>
              <div>
                <label className={labelCls}>Email address *</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => update('email', e.target.value)}
                  placeholder="school@example.com"
                  className={inputCls}
                />
              </div>
            </div>

            <div>
              <label className={labelCls}>Proprietress / Owner name</label>
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="text"
                  value={form.proprietressTitle}
                  onChange={(e) => update('proprietressTitle', e.target.value)}
                  placeholder="Title"
                  className={inputCls}
                />
                <input
                  type="text"
                  value={form.proprietressFirstName}
                  onChange={(e) => update('proprietressFirstName', e.target.value)}
                  placeholder="First name"
                  className={`${inputCls} col-span-2 sm:col-span-1`}
                />
                <input
                  type="text"
                  value={form.proprietressLastName}
                  onChange={(e) => update('proprietressLastName', e.target.value)}
                  placeholder="Last name"
                  className={`${inputCls} col-span-3 sm:col-span-1`}
                />
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div className="mt-5 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="mt-6 pt-4 border-t border-gray-100 flex flex-wrap items-center gap-3">
          <button
            onClick={handleCancel}
            disabled={saving}
            className="px-4 py-2 text-sm text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-mint text-navy text-sm font-semibold rounded-lg hover:bg-mint/90 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save changes'}
          </button>
          {saved && (
            <span className="text-sm text-mint font-medium flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Saved
            </span>
          )}
        </div>
      </div>

      <div className="mt-6 bg-white rounded-xl border border-gray-200 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="w-10 h-10 rounded-full bg-mint-light flex items-center justify-center flex-shrink-0">
          <svg className="w-5 h-5 text-mint" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-navy">Your data is safe with us</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Fees101 takes security seriously and handles school and parent data with care.
          </p>
        </div>
      </div>

      {confirmRemoveLogo && (
        <ConfirmDialog
          title="Remove school logo?"
          message="Invoices and PDFs will fall back to showing the school's initials instead."
          destructive
          confirmLabel="Remove"
          onConfirm={handleRemoveLogo}
          onCancel={() => setConfirmRemoveLogo(false)}
        />
      )}
    </>
  )
}
