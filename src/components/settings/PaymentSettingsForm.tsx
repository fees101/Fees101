'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { savePaymentProvider, testPaymentConnection } from '@/app/(app)/settings/payments/actions'
import type { PaymentSettings } from '@/lib/queries/payments'

interface Props {
  settings: PaymentSettings
  webhookUrl: string
}

export default function PaymentSettingsForm({ settings, webhookUrl }: Props) {
  const router = useRouter()

  const [form, setForm] = useState({
    provider: settings.provider || 'monnify',
    contractCode: settings.contractCode || '',
    apiKey: '',
    secretKey: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const inputCls = "w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40"
  const labelCls = "block text-xs text-gray-500 mb-1"

  function update(patch: Partial<typeof form>) {
    setForm({ ...form, ...patch })
    setSaved(false)
  }

  async function handleSave() {
    setError(null)
    setSaved(false)

    if (!form.contractCode.trim()) return setError('Contract code is required')
    if (!settings.hasApiKey && !form.apiKey.trim()) return setError('API key is required')
    if (!settings.hasSecretKey && !form.secretKey.trim()) return setError('Secret key is required')

    setSaving(true)
    const result = await savePaymentProvider(form)
    setSaving(false)

    if (result.error) return setError(result.error)

    // Clear the secret inputs — they're saved and should never linger in state.
    setForm({ ...form, apiKey: '', secretKey: '' })
    setSaved(true)
    setTestResult(null)
    router.refresh()
  }

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    const result = await testPaymentConnection()
    setTesting(false)
    setTestResult(
      result.success
        ? { ok: true, message: 'Connection successful — credentials are valid.' }
        : { ok: false, message: result.error || 'Connection failed.' }
    )
  }

  async function copyWebhook() {
    try {
      await navigator.clipboard.writeText(webhookUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard unavailable — the field is selectable as a fallback */
    }
  }

  return (
    <div className="space-y-6">
      {/* Status banner */}
      {settings.isConfigured ? (
        <div className="p-4 bg-mint-light border border-mint/40 rounded-xl flex items-start gap-3">
          <svg className="w-5 h-5 text-navy flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <div>
            <p className="text-sm font-semibold text-navy">Online payments are active</p>
            <p className="text-sm text-gray-600 mt-0.5">
              {settings.dvaCount > 0
                ? `${settings.dvaCount} student${settings.dvaCount === 1 ? ' has' : 's have'} a virtual account.`
                : 'No student virtual accounts created yet — open a student to create one.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
          <svg className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M4.93 19h14.14a2 2 0 001.74-3l-7.07-12a2 2 0 00-3.48 0l-7.07 12a2 2 0 001.74 3z" />
          </svg>
          <div>
            <p className="text-sm font-semibold text-amber-800">Online payments not set up yet</p>
            <p className="text-sm text-amber-700 mt-0.5">Enter your provider credentials below to start accepting bank-transfer payments.</p>
          </div>
        </div>
      )}

      {/* Credentials */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
        <h2 className="text-navy font-semibold text-lg mb-1">Provider credentials</h2>
        <p className="text-sm text-gray-500 mb-5">Your keys are encrypted before they&apos;re stored. Leave a key blank to keep the one already saved.</p>

        <div className="space-y-4 max-w-sm">
          <div>
            <label className={labelCls}>Payment provider</label>
            <select
              value={form.provider}
              onChange={(e) => update({ provider: e.target.value })}
              className={inputCls}
            >
              <option value="monnify">Monnify</option>
              <option value="paystack" disabled>Paystack (coming soon)</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Contract code</label>
            <input
              type="text"
              value={form.contractCode}
              onChange={(e) => update({ contractCode: e.target.value })}
              className={inputCls}
              placeholder="e.g. 4934121686"
            />
          </div>
          <div>
            <label className={labelCls}>API key</label>
            <input
              type="password"
              value={form.apiKey}
              onChange={(e) => update({ apiKey: e.target.value })}
              className={inputCls}
              placeholder={settings.hasApiKey ? '•••••••• (saved)' : 'MK_PROD_...'}
              autoComplete="off"
            />
          </div>
          <div>
            <label className={labelCls}>Secret key</label>
            <input
              type="password"
              value={form.secretKey}
              onChange={(e) => update({ secretKey: e.target.value })}
              className={inputCls}
              placeholder={settings.hasSecretKey ? '•••••••• (saved)' : 'Enter secret key'}
              autoComplete="off"
            />
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-mint text-navy text-sm font-semibold rounded-lg hover:bg-mint/90 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save credentials'}
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

      {/* Test connection */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
        <h2 className="text-navy font-semibold text-lg mb-1">Test connection</h2>
        <p className="text-sm text-gray-500 mb-5">Check that your saved credentials authenticate with the provider.</p>
        <div className="flex items-center gap-3">
          <button
            onClick={handleTest}
            disabled={testing || !settings.isConfigured}
            className="px-4 py-2 border border-gray-200 text-navy text-sm font-semibold rounded-lg hover:bg-gray-50 disabled:opacity-50"
            title={settings.isConfigured ? undefined : 'Save your credentials first'}
          >
            {testing ? 'Testing...' : 'Test connection'}
          </button>
          {testResult && (
            <span className={`text-sm font-medium ${testResult.ok ? 'text-mint' : 'text-red-600'}`}>
              {testResult.message}
            </span>
          )}
        </div>
      </div>

      {/* Webhook URL */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
        <h2 className="text-navy font-semibold text-lg mb-1">Webhook URL</h2>
        <p className="text-sm text-gray-500 mb-4">
          Add this URL to your Monnify dashboard (Settings → Webhooks) so payments are recorded automatically.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={webhookUrl}
            readOnly
            onFocus={(e) => e.target.select()}
            className={`${inputCls} bg-gray-50 font-mono text-xs`}
          />
          <button
            onClick={copyWebhook}
            className="px-3 py-2 border border-gray-200 text-navy text-sm font-semibold rounded-lg hover:bg-gray-50 flex-shrink-0"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
    </div>
  )
}
