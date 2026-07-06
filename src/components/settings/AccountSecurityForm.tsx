'use client'

import { useState } from 'react'
import { changePassword } from '@/app/(app)/settings/account-security/actions'

export default function AccountSecurityForm() {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const inputCls = "w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40"
  const labelCls = "block text-xs text-gray-500 mb-1"

  async function handleSubmit() {
    setError(null)
    setSaved(false)

    if (!form.currentPassword) return setError('Current password is required')
    if (form.newPassword.length < 8) return setError('New password must be at least 8 characters')
    if (form.newPassword !== form.confirmPassword) return setError('New passwords do not match')

    setSaving(true)
    const result = await changePassword({
      currentPassword: form.currentPassword,
      newPassword: form.newPassword,
    })
    setSaving(false)

    if (result.error) {
      setError(result.error)
      return
    }
    setForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
    setSaved(true)
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
        <h2 className="text-navy font-semibold text-lg mb-1">Change password</h2>
        <p className="text-sm text-gray-500 mb-5">Use at least 8 characters. You&apos;ll stay signed in on this device.</p>

        <div className="space-y-4 max-w-sm">
          <div>
            <label className={labelCls}>Current password</label>
            <input
              type="password"
              value={form.currentPassword}
              onChange={(e) => { setForm({ ...form, currentPassword: e.target.value }); setSaved(false) }}
              className={inputCls}
              autoComplete="current-password"
            />
          </div>
          <div>
            <label className={labelCls}>New password</label>
            <input
              type="password"
              value={form.newPassword}
              onChange={(e) => { setForm({ ...form, newPassword: e.target.value }); setSaved(false) }}
              className={inputCls}
              autoComplete="new-password"
            />
          </div>
          <div>
            <label className={labelCls}>Confirm new password</label>
            <input
              type="password"
              value={form.confirmPassword}
              onChange={(e) => { setForm({ ...form, confirmPassword: e.target.value }); setSaved(false) }}
              className={inputCls}
              autoComplete="new-password"
            />
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={handleSubmit}
              disabled={saving}
              className="px-4 py-2 bg-mint text-navy text-sm font-semibold rounded-lg hover:bg-mint/90 disabled:opacity-50"
            >
              {saving ? 'Updating...' : 'Update password'}
            </button>
            {saved && (
              <span className="text-sm text-mint font-medium flex items-center gap-1.5">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Password updated
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
        <h2 className="text-navy font-semibold text-lg mb-1">Two-factor authentication</h2>
        <p className="text-sm text-gray-500">Coming soon — an extra layer of security when signing in.</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
        <h2 className="text-navy font-semibold text-lg mb-1">Active sessions</h2>
        <p className="text-sm text-gray-500">Coming soon — see and sign out of other devices logged into your account.</p>
      </div>
    </div>
  )
}
