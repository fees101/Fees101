'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  savePaymentProvider,
  testPaymentConnection,
  runReconciliationNow,
} from '@/app/(app)/school/payments/actions'
import { startBulkDVAJob } from '@/app/(app)/students/[id]/actions'
import { useActiveJobs, useTrackedJob, type TrackedJob } from '@/lib/jobs/ActiveJobsProvider'
import type { PaymentSettings } from '@/lib/queries/payments'
import FieldEditDrawer, { SectionLabel, ChoiceList } from '@/components/settings/FieldEditDrawer'
import Toast from '@/components/ui/Toast'

interface Props {
  settings: PaymentSettings
  webhookBase: string
  actorName: string
}

type EditKey = 'provider' | 'keys' | 'provision'

// Date helpers for the value/description strings ("verified today",
// "Rotated 14 March by you", "last run 08:05").
function isToday(iso: string) {
  return new Date(iso).toDateString() === new Date().toDateString()
}
function fmtDay(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })
}
function fmtVerified(iso: string) {
  return isToday(iso)
    ? 'verified today'
    : `verified ${new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
}
function fmtLastRun(iso: string) {
  return isToday(iso)
    ? `last run ${new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
    : `last run ${new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
}

export default function PaymentSettingsForm({ settings, webhookBase, actorName }: Props) {
  const router = useRouter()

  const [editing, setEditing] = useState<EditKey | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [saved, setSaved] = useState<string | null>(null)

  // Per-editor form state, reset from the saved settings each time an editor opens.
  const [providerForm, setProviderForm] = useState({
    provider: settings.provider || 'monnify',
    mode: settings.mode,
    contractCode: settings.contractCode || '',
  })
  const [keysForm, setKeysForm] = useState({ apiKey: '', secretKey: '' })

  function openEdit(key: EditKey) {
    setError(null)
    setReason('')
    if (key === 'provider') {
      setProviderForm({ provider: settings.provider || 'monnify', mode: settings.mode, contractCode: settings.contractCode || '' })
    }
    if (key === 'keys') setKeysForm({ apiKey: '', secretKey: '' })
    setEditing(key)
  }

  function closeEdit() {
    setEditing(null)
    setError(null)
  }

  // Provider row -----------------------------------------------------------
  const isPaystack = providerForm.provider === 'paystack'
  // The saved, currently-active webhook — shown directly on the page since
  // it's a fact to copy, not something to edit. Distinct from the drawer's
  // own preview URL below, which tracks whatever provider is being chosen.
  const currentWebhookUrl = settings.provider ? `${webhookBase}/${settings.provider}/${settings.schoolId}` : null
  const [copied, setCopied] = useState(false)

  async function saveProvider() {
    setError(null)
    setSaving(true)
    const result = await savePaymentProvider({ ...providerForm, apiKey: '', secretKey: '', reason: reason.trim() || undefined })
    setSaving(false)
    if (result.error) return setError(result.error)
    closeEdit()
    setSaved('Provider')
    router.refresh()
  }

  async function copyWebhook(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard unavailable — the field is selectable as a fallback */
    }
  }

  // API keys row -----------------------------------------------------------
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  async function saveKeys() {
    setError(null)
    if (!settings.hasApiKey && !keysForm.apiKey.trim()) return setError('API key is required')
    if (!settings.hasSecretKey && !keysForm.secretKey.trim()) return setError('Secret key is required')
    setSaving(true)
    const result = await savePaymentProvider({
      provider: settings.provider || providerForm.provider,
      mode: settings.mode,
      contractCode: settings.contractCode || '',
      apiKey: keysForm.apiKey,
      secretKey: keysForm.secretKey,
    })
    setSaving(false)
    if (result.error) return setError(result.error)
    setKeysForm({ apiKey: '', secretKey: '' })
    setTestResult(null)
    closeEdit()
    setSaved('API keys')
    router.refresh()
  }

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    const result = await testPaymentConnection()
    setTesting(false)
    if (result.success) {
      setTestResult({ ok: true, message: 'Connection successful — credentials are valid.' })
      router.refresh()
    } else {
      setTestResult({ ok: false, message: result.error || 'Connection failed.' })
    }
  }

  // Reconciliation row -----------------------------------------------------
  const [reconRunning, setReconRunning] = useState(false)
  const [reconNote, setReconNote] = useState<{ ok: boolean; message: string } | null>(null)

  async function handleReconcile() {
    setReconRunning(true)
    setReconNote(null)
    const result = await runReconciliationNow()
    setReconRunning(false)
    if ('error' in result && result.error) {
      setReconNote({ ok: false, message: result.error })
      return
    }
    if ('success' in result) {
      const applied = result.applied ?? 0
      setReconNote({
        ok: true,
        message: applied > 0
          ? `Applied ${applied} payment${applied === 1 ? '' : 's'} that were missed.`
          : 'Nothing new — everything was already matched.',
      })
      router.refresh()
    }
  }

  // Accounts provisioned (bulk DVA job) ------------------------------------
  const { trackJob, findRunningJob } = useActiveJobs()
  const existingDvaJob = findRunningJob(j => j.jobType === 'bulk_dva')
  const [dvaJobId, setDvaJobId] = useState<string | null>(existingDvaJob?.jobId ?? null)
  const dvaJob = useTrackedJob(dvaJobId)
  const [creatingAll, setCreatingAll] = useState(!!existingDvaJob)
  const [bulkResult, setBulkResult] = useState<
    { ok: false; message: string } | { ok: true; created: number; failed: number; failures: { name: string; error: string }[] } | null
  >(null)
  const progress = dvaJob && dvaJob.status === 'running' ? { done: dvaJob.processed, total: dvaJob.total } : null

  // A resumed page keeps the PROVISION editor open so the job stays visible.
  useEffect(() => {
    if (existingDvaJob) setEditing('provision')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function finalizeAfterDva(finished: TrackedJob) {
    setCreatingAll(false)
    if (finished.status === 'failed') {
      setBulkResult({ ok: false, message: finished.error || 'Something went wrong' })
      return
    }
    if (finished.status === 'cancelled') {
      setBulkResult({ ok: false, message: `Cancelled — ${finished.processed} account${finished.processed === 1 ? '' : 's'} created before stopping.` })
      router.refresh()
      return
    }
    setBulkResult({
      ok: true,
      created: finished.processed,
      failed: finished.failed ?? 0,
      failures: (finished.failures ?? []).map(f => ({ name: f.label, error: f.error })),
    })
    router.refresh()
  }

  // If this instance resumed an already-running job instead of starting one
  // itself, the trackJob onComplete below was registered by a previous, now
  // unmounted instance and won't fire here — without this, a resumed page
  // would sit on "Creating accounts..." forever once the job finishes.
  const resumedDvaRef = useRef(!!existingDvaJob)
  useEffect(() => {
    if (!resumedDvaRef.current || !dvaJob || dvaJob.status === 'running') return
    resumedDvaRef.current = false
    finalizeAfterDva(dvaJob)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dvaJob])

  async function handleCreateAll() {
    setCreatingAll(true)
    setBulkResult(null)
    const start = await startBulkDVAJob()
    if ('error' in start) {
      setBulkResult({ ok: false, message: start.error || 'Something went wrong' })
      setCreatingAll(false)
      return
    }
    if (!start.jobId) {
      setCreatingAll(false)
      setBulkResult({ ok: true, created: 0, failed: 0, failures: [] })
      return
    }
    setDvaJobId(start.jobId)
    trackJob(start.jobId, 'bulk_dva', 'Creating payment accounts', { processed: start.processed, total: start.total }, (finished) => finalizeAfterDva(finished), { href: '/school/payments' })
  }

  // Derived value strings for each row -------------------------------------
  const providerLabel = settings.provider === 'paystack' ? 'Paystack' : settings.provider === 'monnify' ? 'Monnify' : null
  const providerValue = providerLabel ? `${providerLabel} · ${settings.mode}` : 'Not connected'

  const keysValue = settings.keysVerifiedAt
    ? `Valid · ${fmtVerified(settings.keysVerifiedAt)}`
    : settings.hasApiKey && settings.hasSecretKey
      ? 'Saved · not verified'
      : 'Not set'
  const keysDesc = settings.keysRotatedAt
    ? `Rotated ${fmtDay(settings.keysRotatedAt)} by ${settings.keysRotatedByLabel ?? 'an admin'}`
    : 'Encrypted before they are stored'

  const totalStudents = settings.dvaCount + settings.studentsWithoutDvaCount
  const provisionValue = `${settings.dvaCount} of ${totalStudents}`

  const reconValue = settings.lastReconciledAt
    ? `Automatic · ${fmtLastRun(settings.lastReconciledAt)}`
    : 'Automatic · not run yet'

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ borderTop: '2px solid var(--color-ink)', paddingTop: 18 }}>
        <h2 className="text-2xl font-extrabold tracking-[-0.015em] text-[var(--color-ink)]" style={{ margin: 0 }}>
          Payments
        </h2>
        <p className="text-[13px] text-[var(--color-neutral-800)]" style={{ maxWidth: '74ch', marginTop: 8 }}>
          How money reaches the school. Without a provider, no student can be given an account to pay into.
        </p>
      </div>

      <div style={{ marginTop: 8 }}>
        {/* Provider */}
        <SettingRow
          label="Provider"
          desc="Creates a virtual account per student"
          value={providerValue}
          valueTone={settings.isConfigured ? 'ink' : 'muted'}
          actionLabel="CHANGE"
          onEdit={() => openEdit('provider')}
        />

        {/* Webhook URL — a fact to copy, not something to edit, so it lives
            directly on the page rather than behind the Provider drawer. */}
        {currentWebhookUrl && (
          <div className="m-setrow">
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-ink)', margin: 0 }}>Webhook URL</p>
              <p className="text-[13px] text-[var(--color-neutral-700)]" style={{ margin: '4px 0 0' }}>
                Add this in your {providerLabel} dashboard so payments record automatically.
              </p>
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="flex items-center gap-2">
                <input type="text" value={currentWebhookUrl} readOnly onFocus={(e) => e.target.select()} className="m-input bg-[var(--color-surface)] font-mono text-xs" style={{ flex: 1, minWidth: 0 }} />
                <button type="button" onClick={() => copyWebhook(currentWebhookUrl)} className="m-btn m-btn-outline flex-shrink-0">{copied ? 'Copied' : 'Copy'}</button>
              </div>
            </div>
          </div>
        )}

        {/* API keys */}
        <SettingRow
          label="API keys"
          desc={keysDesc}
          value={keysValue}
          valueTone={settings.hasApiKey ? 'ink' : 'muted'}
          actionLabel="ROTATE"
          editing={editing === 'keys'}
          onEdit={() => openEdit('keys')}
          onSave={saveKeys}
          onCancel={closeEdit}
          saving={saving}
          error={error}
        >
          <div className="space-y-4" style={{ maxWidth: 360 }}>
            <p className="text-[13px] text-[var(--color-neutral-700)]">Leave a field blank to keep the key already saved. New keys are encrypted before storage.</p>
            <label className="block">
              <span className="m-label">{isPaystack ? 'Public key' : 'API key'}</span>
              <input type="password" value={keysForm.apiKey} onChange={(e) => setKeysForm(f => ({ ...f, apiKey: e.target.value }))} className="m-input" placeholder={settings.hasApiKey ? '•••••••• (saved)' : (isPaystack ? 'pk_live_...' : 'MK_PROD_...')} autoComplete="off" />
            </label>
            <label className="block">
              <span className="m-label">Secret key</span>
              <input type="password" value={keysForm.secretKey} onChange={(e) => setKeysForm(f => ({ ...f, secretKey: e.target.value }))} className="m-input" placeholder={settings.hasSecretKey ? '•••••••• (saved)' : (isPaystack ? 'sk_live_...' : 'Enter secret key')} autoComplete="off" />
            </label>
            <div className="flex items-center gap-3">
              <button type="button" onClick={handleTest} disabled={testing || !settings.isConfigured} className="m-btn m-btn-outline" title={settings.isConfigured ? undefined : 'Save your credentials first'}>
                {testing ? 'Testing...' : 'Test connection'}
              </button>
              {testResult && (
                <span className={`text-sm font-medium ${testResult.ok ? 'text-[var(--color-ink)]' : 'text-[var(--color-signal-text)]'}`}>{testResult.message}</span>
              )}
            </div>
          </div>
        </SettingRow>

        {/* Accounts provisioned */}
        <SettingRow
          label="Accounts provisioned"
          desc="Students who have somewhere to pay"
          value={provisionValue}
          valueTone={settings.studentsWithoutDvaCount > 0 ? 'ochre' : 'ink'}
          actionLabel="PROVISION"
          actionDisabled={!settings.isConfigured}
          editing={editing === 'provision'}
          onEdit={() => { setBulkResult(null); setEditing('provision') }}
          onCancel={closeEdit}
          cancelLabel="Close"
        >
          <div style={{ maxWidth: 460 }}>
            <p className="text-[13px] text-[var(--color-neutral-700)] mb-4">
              Each student needs a virtual account for parents to pay into.{' '}
              <span className="text-[var(--color-ink)] font-medium m-num">{settings.dvaCount}</span> created
              {settings.studentsWithoutDvaCount > 0 && (
                <> · <span className="text-[var(--color-ochre-text)] font-medium m-num">{settings.studentsWithoutDvaCount}</span> still need one</>
              )}.
            </p>
            <button type="button" onClick={handleCreateAll} disabled={creatingAll || settings.studentsWithoutDvaCount === 0} className="m-btn m-btn-primary">
              {creatingAll
                ? 'Creating accounts…'
                : settings.studentsWithoutDvaCount === 0
                  ? 'All students have accounts'
                  : `Create accounts for ${settings.studentsWithoutDvaCount} student${settings.studentsWithoutDvaCount === 1 ? '' : 's'}`}
            </button>

            {progress && progress.total > 0 && (
              <div className="mt-4">
                <div className="flex justify-between text-xs text-[var(--color-neutral-700)] mb-1">
                  <span>Creating virtual accounts… you can leave this page, it keeps running.</span>
                  <span className="m-num">{progress.done} / {progress.total}</span>
                </div>
                <div className="h-[3px] bg-[var(--color-neutral-300)]">
                  <div className="h-full bg-[var(--color-ink)] transition-all" style={{ transitionDuration: 'var(--dur-settle)', width: `${Math.min(100, Math.round((progress.done / progress.total) * 100))}%` }} />
                </div>
              </div>
            )}

            {bulkResult && (
              bulkResult.ok ? (
                <div className="mt-4 p-3 border-l-[3px] border-[var(--color-ink)] bg-[color-mix(in_srgb,var(--color-ink)_8%,transparent)] text-sm text-[var(--color-ink)]">
                  Created <span className="font-semibold m-num">{bulkResult.created}</span> account{bulkResult.created === 1 ? '' : 's'}.
                  {bulkResult.failed > 0 && (
                    <div className="mt-2 text-[var(--color-signal-text)]">
                      <span className="font-semibold m-num">{bulkResult.failed}</span> failed:
                      <ul className="list-disc list-inside mt-1">
                        {bulkResult.failures.slice(0, 5).map((f, i) => (<li key={i}>{f.name} — {f.error}</li>))}
                        {bulkResult.failures.length > 5 && <li>…and {bulkResult.failures.length - 5} more</li>}
                      </ul>
                      You can retry — accounts already created won&apos;t be duplicated.
                    </div>
                  )}
                </div>
              ) : (
                <div className="mt-4 p-3 bg-[var(--color-signal-100)] border-l-[3px] border-[var(--color-signal)] text-sm text-[var(--color-signal-text)]">{bulkResult.message}</div>
              )
            )}
          </div>
        </SettingRow>

        {/* Reconciliation */}
        <SettingRow
          label="Reconciliation"
          desc="Matches incoming transfers to invoices"
          value={reconValue}
          valueTone={settings.lastReconciledAt ? 'ink' : 'muted'}
          actionLabel={reconRunning ? 'RUNNING' : 'RUN NOW'}
          actionKind="run"
          actionDisabled={reconRunning || !settings.isConfigured}
          onAction={handleReconcile}
          note={reconNote && (
            <span className={reconNote.ok ? 'text-[var(--color-ink)]' : 'text-[var(--color-signal-text)]'}>{reconNote.message}</span>
          )}
        />
      </div>

      {editing === 'provider' && (
        <FieldEditDrawer
          title="Provider"
          subtitle="Creates a virtual account per student"
          currentDisplay={providerValue}
          reason={reason}
          onReasonChange={setReason}
          actorName={actorName}
          onClose={closeEdit}
          onSave={saveProvider}
          saving={saving}
          error={error}
          saveLabel="Save change"
        >
          <div style={{ marginBottom: 16 }}>
            <SectionLabel>Choose one</SectionLabel>
            <ChoiceList
              value={providerForm.provider}
              onChange={(v) => setProviderForm(f => ({ ...f, provider: v }))}
              options={[
                { value: 'monnify', label: 'Monnify' },
                { value: 'paystack', label: 'Paystack' },
              ]}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <SectionLabel>Environment</SectionLabel>
            <select value={providerForm.mode} onChange={(e) => setProviderForm(f => ({ ...f, mode: e.target.value as 'test' | 'live' }))} className="m-select" style={{ width: '100%' }}>
              <option value="test">Test</option>
              <option value="live">Live</option>
            </select>
          </div>

          {!isPaystack && (
            <div style={{ marginBottom: 16 }}>
              <SectionLabel>Contract code</SectionLabel>
              <input type="text" value={providerForm.contractCode} onChange={(e) => setProviderForm(f => ({ ...f, contractCode: e.target.value }))} className="m-input" style={{ width: '100%', boxSizing: 'border-box' }} placeholder="e.g. 4934121686" />
            </div>
          )}

          <p className="text-[12px] leading-relaxed text-[var(--color-neutral-700)]" style={{ marginBottom: 16 }}>
            Changing the provider does not move existing virtual accounts — students keep the one they already have until re-provisioned.
            The webhook URL to add in {isPaystack ? 'Paystack' : 'Monnify'} will update on the Payments page once this is saved.
          </p>
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
    </div>
  )
}

// One ruled payment-setting row, sharing the School-profile ledger geometry
// (.m-setrow): label + description left, current value on the aligned column,
// action word flush right. EDIT-style actions expand the inline editor below
// the value; RUN actions fire immediately; disabled actions are inert.
function SettingRow({
  label, desc, value, valueTone, actionLabel, actionKind = 'edit', actionDisabled,
  editing, onEdit, onAction, onSave, onCancel, cancelLabel = 'Cancel', saving, error, note, children,
}: {
  label: string
  desc: string
  value: string
  valueTone: 'ink' | 'ledger' | 'muted' | 'ochre'
  actionLabel: string
  actionKind?: 'edit' | 'run'
  actionDisabled?: boolean
  editing?: boolean
  onEdit?: () => void
  onAction?: () => void
  onSave?: () => void
  onCancel?: () => void
  cancelLabel?: string
  saving?: boolean
  error?: string | null
  note?: React.ReactNode
  children?: React.ReactNode
}) {
  const valueColor =
    valueTone === 'ledger' ? 'var(--color-ledger)'
    : valueTone === 'ochre' ? 'var(--color-ochre-text)'
    : valueTone === 'muted' ? 'var(--color-neutral-500)'
    : 'var(--color-ink)'
  const bold = valueTone === 'ledger' || valueTone === 'ochre'

  return (
    <div className="m-setrow">
      <div style={{ minWidth: 0 }}>
        <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-ink)', margin: 0 }}>{label}</p>
        <p className="text-[13px] text-[var(--color-neutral-700)]" style={{ margin: '4px 0 0' }}>{desc}</p>
      </div>

      {editing ? (
        <div style={{ minWidth: 0 }}>
          {children}
          {error && (
            <div className="mt-3 p-3 text-sm text-[var(--color-signal-text)]" style={{ background: 'var(--color-signal-100)', borderLeft: '3px solid var(--color-signal)' }}>
              {error}
            </div>
          )}
          <div className="mt-4 flex items-center gap-3">
            {onSave && <button onClick={onSave} disabled={saving} className="m-btn m-btn-primary">{saving ? 'Saving...' : 'Save'}</button>}
            {onCancel && <button onClick={onCancel} disabled={saving} className="m-btn m-btn-outline">{cancelLabel}</button>}
          </div>
        </div>
      ) : (
        <div className="m-setrow__side">
          <div style={{ minWidth: 0 }}>
            <p className="text-[15px]" style={{ margin: 0, wordBreak: 'break-word', color: valueColor, fontWeight: bold ? 600 : 400 }}>{value}</p>
            {note && <p className="text-[13px]" style={{ margin: '4px 0 0' }}>{note}</p>}
          </div>
          <button
            onClick={actionKind === 'run' ? onAction : onEdit}
            disabled={actionDisabled}
            style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--color-ink)', whiteSpace: 'nowrap' }}
            className="hover:text-[var(--color-signal-text)] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {actionLabel}
          </button>
        </div>
      )}
    </div>
  )
}
