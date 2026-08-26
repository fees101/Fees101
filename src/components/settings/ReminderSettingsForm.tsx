'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { saveReminderSettings } from '@/app/(app)/settings/reminders/actions'
import type { ReminderSettings } from '@/lib/queries/reminders'

interface Props {
  settings: ReminderSettings
}

export default function ReminderSettingsForm({ settings }: Props) {
  const router = useRouter()

  const [form, setForm] = useState({
    enabled: settings.enabled,
    advanceEnabled: settings.advanceDays !== null,
    advanceDays: settings.advanceDays ?? 3,
    dueDayEnabled: settings.dueDayEnabled,
    overdueEnabled: settings.overdueEnabled,
    overdueIntervalUnit: settings.overdueIntervalUnit,
    overdueIntervalValue: settings.overdueIntervalValue,
    overdueCapped: settings.overdueMaxReminders !== null,
    overdueMaxReminders: settings.overdueMaxReminders ?? 10,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [togglingEnabled, setTogglingEnabled] = useState(false)

  const inputCls = "w-24 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40"
  const labelCls = "text-sm text-navy font-medium"
  const rowCls = "flex items-center justify-between gap-4 py-3"

  function update(patch: Partial<typeof form>) {
    setForm({ ...form, ...patch })
    setSaved(false)
  }

  async function persist(next: typeof form) {
    const result = await saveReminderSettings({
      enabled: next.enabled,
      advanceDays: next.advanceEnabled ? Number(next.advanceDays) : null,
      dueDayEnabled: next.dueDayEnabled,
      overdueEnabled: next.overdueEnabled,
      overdueIntervalUnit: next.overdueIntervalUnit,
      overdueIntervalValue: Number(next.overdueIntervalValue),
      overdueMaxReminders: next.overdueCapped ? Number(next.overdueMaxReminders) : null,
    })
    return result
  }

  async function handleSave() {
    setError(null)
    setSaved(false)
    setSaving(true)

    const result = await persist(form)

    setSaving(false)
    if (result.error) return setError(result.error)

    setSaved(true)
    router.refresh()
  }

  // The master switch reads as an instant on/off toggle (same as every other
  // toggle in this app), so unlike the rest of this form it must persist the
  // moment it's clicked — waiting for "Save settings" meant a flip was
  // silently lost if you navigated away first.
  async function handleToggleEnabled(nextEnabled: boolean) {
    setError(null)
    setTogglingEnabled(true)
    const next = { ...form, enabled: nextEnabled }
    setForm(next)

    const result = await persist(next)

    setTogglingEnabled(false)
    if (result.error) {
      setForm(form)
      setError(result.error)
      return
    }
    router.refresh()
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
        <div className={`${rowCls} border-b border-gray-100`}>
          <div>
            <h2 className="text-navy font-semibold text-lg">Payment reminders</h2>
            <p className="text-sm text-gray-500 mt-0.5">Automatic SMS reminders to parents about unpaid invoices. Reminders keep going until an invoice is paid in full.</p>
          </div>
          <label className={`relative inline-flex items-center flex-shrink-0 ${togglingEnabled ? 'opacity-60 cursor-wait' : 'cursor-pointer'}`}>
            <input
              type="checkbox"
              checked={form.enabled}
              disabled={togglingEnabled}
              onChange={(e) => handleToggleEnabled(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 rounded-full peer peer-checked:bg-mint peer-focus:outline-none transition-colors" />
            <div className="absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform peer-checked:translate-x-5" />
          </label>
        </div>

        <div className={`${form.enabled ? '' : 'opacity-40 pointer-events-none'}`}>
          {/* Advance reminder */}
          <div className={`${rowCls} border-b border-gray-100`}>
            <div className="flex items-center gap-3">
              <input type="checkbox" checked={form.advanceEnabled} onChange={(e) => update({ advanceEnabled: e.target.checked })} className="w-4 h-4 accent-mint" />
              <div>
                <p className={labelCls}>Remind before the due date</p>
                <p className="text-xs text-gray-500">Sent once per invoice</p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <input
                type="number"
                min={1}
                value={form.advanceDays}
                disabled={!form.advanceEnabled}
                onChange={(e) => update({ advanceDays: Number(e.target.value) })}
                className={inputCls}
              />
              <span className="text-sm text-gray-500">days before</span>
            </div>
          </div>

          {/* Due day reminder */}
          <div className={`${rowCls} border-b border-gray-100`}>
            <div className="flex items-center gap-3">
              <input type="checkbox" checked={form.dueDayEnabled} onChange={(e) => update({ dueDayEnabled: e.target.checked })} className="w-4 h-4 accent-mint" />
              <div>
                <p className={labelCls}>Remind on the due date</p>
                <p className="text-xs text-gray-500">Sent once per invoice</p>
              </div>
            </div>
          </div>

          {/* Overdue reminder */}
          <div className={rowCls}>
            <div className="flex items-center gap-3">
              <input type="checkbox" checked={form.overdueEnabled} onChange={(e) => update({ overdueEnabled: e.target.checked })} className="w-4 h-4 accent-mint" />
              <div>
                <p className={labelCls}>Remind after the due date</p>
                <p className="text-xs text-gray-500">Repeats until paid, unless capped below</p>
              </div>
            </div>
          </div>

          <div className={`pl-7 pb-3 space-y-3 ${form.overdueEnabled ? '' : 'opacity-40 pointer-events-none'}`}>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">Repeat every</span>
              <input
                type="number"
                min={1}
                value={form.overdueIntervalValue}
                onChange={(e) => update({ overdueIntervalValue: Number(e.target.value) })}
                className={inputCls}
              />
              <select
                value={form.overdueIntervalUnit}
                onChange={(e) => update({ overdueIntervalUnit: e.target.value as 'minutes' | 'days' })}
                className="px-2 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40"
              >
                <option value="days">days</option>
                <option value="minutes">minutes (testing)</option>
              </select>
            </div>
            <div className="flex items-center gap-3">
              <input type="checkbox" checked={form.overdueCapped} onChange={(e) => update({ overdueCapped: e.target.checked })} className="w-4 h-4 accent-mint" />
              <span className="text-sm text-gray-500">Stop after</span>
              <input
                type="number"
                min={1}
                value={form.overdueMaxReminders}
                disabled={!form.overdueCapped}
                onChange={(e) => update({ overdueMaxReminders: Number(e.target.value) })}
                className={inputCls}
              />
              <span className="text-sm text-gray-500">reminders</span>
            </div>
          </div>
        </div>

        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex items-center gap-3 pt-4">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-mint text-navy text-sm font-semibold rounded-lg hover:bg-mint/90 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save settings'}
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
    </div>
  )
}
