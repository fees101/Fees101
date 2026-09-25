'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { saveReminderSettings } from '@/app/(app)/school/reminders/actions'
import type { ReminderSettings } from '@/lib/queries/reminders'
import FieldEditDrawer, { SectionLabel, ChoiceList, CheckList } from '@/components/settings/FieldEditDrawer'
import Toast from '@/components/ui/Toast'

interface Props {
  settings: ReminderSettings
  actorName: string
}

// Flat rectangular switch — the app's one toggle pattern: ink fill when on,
// hairline outline when off, zero radius. Used inside the EDIT editors here;
// the whole-row TOGGLE actions persist instantly via the action word instead.
function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center border-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
        checked ? 'bg-[var(--color-ink)] border-[var(--color-ink)]' : 'bg-transparent border-[var(--color-neutral-400)]'
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform transition-transform ${
          checked ? 'translate-x-[18px] bg-[var(--color-paper)]' : 'translate-x-0.5 bg-[var(--color-neutral-500)]'
        }`}
      />
    </button>
  )
}

// The value 2 is the recommended overdue cap: the first SMS recovers most of
// what a chase ever will, and a third send adds almost nothing.
const RECOMMENDED_MAX = 2

const ADVANCE_PRESETS = [1, 3, 7, 14]
const OVERDUE_PRESETS = [3, 7, 14]
const MAX_PRESETS = [1, 2, 3, 5]

type EditKey = 'advance' | 'overdue' | 'max' | 'channel'

const ROW_LABELS: Record<EditKey, string> = {
  advance: 'Advance reminder',
  overdue: 'Overdue repeats',
  max: 'Maximum overdue reminders',
  channel: 'Channel',
}

export default function ReminderSettingsForm({ settings, actorName }: Props) {
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
    emailEnabled: settings.channels.email,
  })
  const [snapshot, setSnapshot] = useState(form)
  const [editing, setEditing] = useState<EditKey | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toggling, setToggling] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [saved, setSaved] = useState<string | null>(null)

  // "Custom" is a UI mode, not a stored value — it just decides whether the
  // choice list shows a checked preset row or the free-entry row. Seeded from
  // whatever's already saved so a non-preset number (e.g. 5 days) opens
  // straight into Custom instead of looking like nothing is selected.
  const [advanceCustom, setAdvanceCustom] = useState(!ADVANCE_PRESETS.includes(settings.advanceDays ?? 3))
  const [maxCustom, setMaxCustom] = useState(!MAX_PRESETS.includes(settings.overdueMaxReminders ?? 10))

  function update(patch: Partial<typeof form>) {
    setForm(f => ({ ...f, ...patch }))
  }

  function openEdit(key: EditKey) {
    setSnapshot(form)
    setError(null)
    setReason('')
    if (key === 'advance') setAdvanceCustom(!ADVANCE_PRESETS.includes(form.advanceDays))
    if (key === 'max') setMaxCustom(!MAX_PRESETS.includes(form.overdueMaxReminders))
    setEditing(key)
  }

  function cancelEdit() {
    setForm(snapshot)
    setEditing(null)
  }

  async function persist(next: typeof form, reasonText?: string) {
    return saveReminderSettings({
      enabled: next.enabled,
      advanceDays: next.advanceEnabled ? Number(next.advanceDays) : null,
      dueDayEnabled: next.dueDayEnabled,
      overdueEnabled: next.overdueEnabled,
      overdueIntervalUnit: next.overdueIntervalUnit,
      overdueIntervalValue: Number(next.overdueIntervalValue),
      overdueMaxReminders: next.overdueCapped ? Number(next.overdueMaxReminders) : null,
      channels: { sms: true, email: next.emailEnabled, whatsapp: false },
      reason: reasonText?.trim() || undefined,
    })
  }

  async function saveEdit() {
    setError(null)
    setSaving(true)
    const result = await persist(form, reason)
    setSaving(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setEditing(null)
    setSaved(editing ? ROW_LABELS[editing] : null)
    router.refresh()
  }

  // Whole-row TOGGLE actions persist the moment they are clicked — the same
  // instant behaviour the master switch has always had, so a flip is never
  // silently lost by navigating away before a Save.
  async function instantToggle(key: string, patch: Partial<typeof form>, label: string) {
    setError(null)
    setToggling(key)
    const next = { ...form, ...patch }
    setForm(next)
    const result = await persist(next)
    setToggling(null)
    if (result.error) {
      setForm(form)
      setError(result.error)
      return
    }
    setSaved(label)
    router.refresh()
  }

  const unitLabel = form.overdueIntervalUnit === 'minutes' ? 'minutes' : 'days'
  const advanceValue = form.advanceEnabled ? `${form.advanceDays} ${form.advanceDays === 1 ? 'day' : 'days'} before` : 'Off'
  const overdueValue = form.overdueEnabled ? `Every ${form.overdueIntervalValue} ${form.overdueIntervalValue === 1 ? unitLabel.replace(/s$/, '') : unitLabel}` : 'Off'
  const maxValue = form.overdueCapped
    ? `${form.overdueMaxReminders}${form.overdueMaxReminders === RECOMMENDED_MAX ? ' · recommended' : ''}`
    : 'No limit'
  const maxIsRecommended = form.overdueCapped && form.overdueMaxReminders === RECOMMENDED_MAX
  const channelValue = form.emailEnabled ? 'SMS and email' : 'SMS'

  // Which "Choose one" row is checked. A stored value outside the preset list
  // (e.g. a custom interval, or the testing-only minutes unit) leaves the
  // list showing nothing checked rather than falsely landing on a neighbour.
  const overdueChoice = !form.overdueEnabled
    ? 'never'
    : form.overdueIntervalUnit === 'days' && OVERDUE_PRESETS.includes(form.overdueIntervalValue)
      ? String(form.overdueIntervalValue)
      : '__custom__'

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ borderTop: '2px solid var(--color-ink)', paddingTop: 18 }}>
        <h2 className="text-2xl font-extrabold tracking-[-0.015em] text-[var(--color-ink)]" style={{ margin: 0 }}>
          Reminders
        </h2>
        <p className="text-[13px] text-[var(--color-neutral-800)]" style={{ maxWidth: '74ch', marginTop: 8 }}>
          When the school chases a parent automatically. Chasing works — the first SMS recovers 41% within seven
          days — but a third send adds almost nothing.
        </p>
      </div>

      <div style={{ marginTop: 8 }}>
        {/* Reminders enabled — master switch, instant */}
        <SettingRow
          label="Reminders enabled"
          desc="Master switch for all automatic chasing"
          value={form.enabled ? 'On' : 'Off'}
          valueTone={form.enabled ? 'ink' : 'muted'}
          action="TOGGLE"
          onAction={() => instantToggle('enabled', { enabled: !form.enabled }, 'Reminders enabled')}
          actionDisabled={toggling === 'enabled'}
        />

        <div className={form.enabled ? '' : 'opacity-40 pointer-events-none'}>
          {/* Advance reminder */}
          <SettingRow
            label="Advance reminder"
            desc="Days before the due date"
            value={advanceValue}
            valueTone={form.advanceEnabled ? 'ink' : 'muted'}
            action="EDIT"
            onAction={() => openEdit('advance')}
          />

          {/* On the due date — instant toggle */}
          <SettingRow
            label="On the due date"
            desc="A single reminder on the day"
            value={form.dueDayEnabled ? 'On' : 'Off'}
            valueTone={form.dueDayEnabled ? 'ink' : 'muted'}
            action="TOGGLE"
            onAction={() => instantToggle('dueDay', { dueDayEnabled: !form.dueDayEnabled }, 'On the due date')}
            actionDisabled={toggling === 'dueDay'}
          />

          {/* Overdue repeats */}
          <SettingRow
            label="Overdue repeats"
            desc="How often after the due date"
            value={overdueValue}
            valueTone={form.overdueEnabled ? 'ink' : 'muted'}
            action="EDIT"
            onAction={() => openEdit('overdue')}
          />

          {/* Maximum overdue reminders */}
          <SettingRow
            label="Maximum overdue reminders"
            desc="Stops chasing after this many"
            value={maxValue}
            valueTone={maxIsRecommended || form.overdueCapped ? 'ink' : 'muted'}
            action="EDIT"
            onAction={() => openEdit('max')}
          />

          {/* Channel */}
          <SettingRow
            label="Channel"
            desc="SMS costs money; email does not"
            value={channelValue}
            valueTone="ink"
            action="EDIT"
            onAction={() => openEdit('channel')}
          />
        </div>
      </div>

      {editing === 'advance' && (
        <FieldEditDrawer
          title="Advance reminder"
          subtitle="A reminder sent once before the invoice is due, to parents with anything outstanding."
          currentDisplay={advanceValue}
          reason={reason}
          onReasonChange={setReason}
          actorName={actorName}
          onClose={cancelEdit}
          onSave={saveEdit}
          saving={saving}
          error={error}
        >
          <div className="flex items-center gap-3" style={{ marginBottom: 16 }}>
            <Switch checked={form.advanceEnabled} onChange={(v) => update({ advanceEnabled: v })} label="Remind before the due date" />
            <span className="text-sm text-[var(--color-neutral-800)]">Send a reminder before the due date</span>
          </div>

          <div style={{ marginBottom: 16 }}>
            <SectionLabel>Choose one</SectionLabel>
            <ChoiceList
              disabled={!form.advanceEnabled}
              value={advanceCustom ? 'custom' : String(form.advanceDays)}
              onChange={(v) => {
                if (v === 'custom') { setAdvanceCustom(true); return }
                setAdvanceCustom(false)
                update({ advanceDays: Number(v) })
              }}
              options={[
                ...ADVANCE_PRESETS.map(d => ({ value: String(d), label: `${d} ${d === 1 ? 'day' : 'days'} before` })),
                {
                  value: 'custom',
                  label: 'Custom',
                  render: advanceCustom ? (
                    <div className="flex items-center gap-2" style={{ marginLeft: 'auto' }} onClick={(e) => e.stopPropagation()}>
                      <input type="number" min={1} value={form.advanceDays} onChange={(e) => update({ advanceDays: Number(e.target.value) })} className="m-input w-20" />
                      <span className="text-xs text-[var(--color-neutral-700)]">days before</span>
                    </div>
                  ) : undefined,
                },
              ]}
            />
          </div>

          <p className="text-[12px] leading-relaxed text-[var(--color-neutral-700)]" style={{ marginBottom: 16 }}>
            Sent once, to parents with anything outstanding.
          </p>
        </FieldEditDrawer>
      )}

      {editing === 'overdue' && (
        <FieldEditDrawer
          title="Overdue repeats"
          subtitle="How often the school chases after the due date passes."
          currentDisplay={overdueValue}
          reason={reason}
          onReasonChange={setReason}
          actorName={actorName}
          onClose={cancelEdit}
          onSave={saveEdit}
          saving={saving}
          error={error}
        >
          <div style={{ marginBottom: 16 }}>
            <SectionLabel>Choose one</SectionLabel>
            <ChoiceList
              value={overdueChoice}
              onChange={(v) => {
                if (v === 'never') { update({ overdueEnabled: false }); return }
                update({ overdueEnabled: true, overdueIntervalUnit: 'days', overdueIntervalValue: Number(v) })
              }}
              options={[
                ...OVERDUE_PRESETS.map(d => ({ value: String(d), label: `Every ${d} days` })),
                { value: 'never', label: 'Never repeat' },
              ]}
            />
          </div>

          <p className="text-[12px] leading-relaxed text-[var(--color-neutral-700)]" style={{ marginBottom: 16 }}>
            The first SMS recovers 41% within seven days. A third adds almost nothing.
          </p>
        </FieldEditDrawer>
      )}

      {editing === 'max' && (
        <FieldEditDrawer
          title="Maximum overdue reminders"
          subtitle="Stop chasing once this many overdue reminders have gone out."
          currentDisplay={maxValue}
          reason={reason}
          onReasonChange={setReason}
          actorName={actorName}
          onClose={cancelEdit}
          onSave={saveEdit}
          saving={saving}
          error={error}
        >
          <div className="flex items-center gap-3" style={{ marginBottom: 16 }}>
            <Switch checked={form.overdueCapped} onChange={(v) => update({ overdueCapped: v })} label="Stop after a number of reminders" />
            <span className="text-sm text-[var(--color-neutral-800)]">{form.overdueCapped ? 'Stop chasing after a set number of reminders' : 'No limit — keeps chasing until paid'}</span>
          </div>

          <div style={{ marginBottom: 16 }}>
            <SectionLabel>Choose one</SectionLabel>
            <ChoiceList
              disabled={!form.overdueCapped}
              value={maxCustom ? 'custom' : String(form.overdueMaxReminders)}
              onChange={(v) => {
                if (v === 'custom') { setMaxCustom(true); return }
                setMaxCustom(false)
                update({ overdueMaxReminders: Number(v) })
              }}
              options={[
                ...MAX_PRESETS.map(n => ({ value: String(n), label: n === RECOMMENDED_MAX ? `${n} · recommended` : String(n) })),
                {
                  value: 'custom',
                  label: 'Custom',
                  render: maxCustom ? (
                    <div className="flex items-center gap-2" style={{ marginLeft: 'auto' }} onClick={(e) => e.stopPropagation()}>
                      <input type="number" min={1} value={form.overdueMaxReminders} onChange={(e) => update({ overdueMaxReminders: Number(e.target.value) })} className="m-input w-20" />
                      <span className="text-xs text-[var(--color-neutral-700)]">reminders</span>
                    </div>
                  ) : undefined,
                },
              ]}
            />
          </div>

          <p className="text-[12px] leading-relaxed text-[var(--color-neutral-700)]" style={{ marginBottom: 16 }}>
            Chasing stops after this many, whatever the balance.
          </p>
        </FieldEditDrawer>
      )}

      {editing === 'channel' && (
        <FieldEditDrawer
          title="Channel"
          subtitle="SMS costs money; email does not"
          currentDisplay={channelValue}
          reason={reason}
          onReasonChange={setReason}
          actorName={actorName}
          onClose={cancelEdit}
          onSave={saveEdit}
          saving={saving}
          error={error}
        >
          <div style={{ marginBottom: 16 }}>
            <SectionLabel>Tick everyone allowed</SectionLabel>
            <CheckList
              value={form.emailEnabled ? ['sms', 'email'] : ['sms']}
              onChange={(next) => update({ emailEnabled: next.includes('email') })}
              options={[
                { value: 'sms', label: 'SMS', locked: true },
                { value: 'email', label: 'Email' },
                { value: 'whatsapp', label: 'WhatsApp', disabled: true, badge: 'Coming soon' },
              ]}
            />
          </div>

          <p className="text-[12px] leading-relaxed text-[var(--color-neutral-700)]" style={{ marginBottom: 16 }}>
            SMS is always on — it is the channel every parent can receive without an app or an email address. Turn
            email on to send the same reminder there too, when a parent&apos;s email is on file.
          </p>
        </FieldEditDrawer>
      )}

      {error && !editing && (
        <div className="mt-4 p-3 bg-[var(--color-signal-100)] border-l-[3px] border-[var(--color-signal)] text-sm text-[var(--color-signal-text)]">
          {error}
        </div>
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

// One ruled reminder-setting row, sharing the School-profile ledger geometry
// (.m-setrow): label + description left, current value on the aligned column,
// action word flush right (TOGGLE persists instantly, EDIT expands the inline
// editor, FIXED is inert), or the editor spanning the value column when open.
function SettingRow({
  label, desc, value, valueTone, action, onAction, actionDisabled, editing, onSave, onCancel, saving, error, children,
}: {
  label: string
  desc: string
  value: string
  valueTone: 'ink' | 'ledger' | 'muted'
  action: 'TOGGLE' | 'EDIT' | 'FIXED'
  onAction?: () => void
  actionDisabled?: boolean
  editing?: boolean
  onSave?: () => void
  onCancel?: () => void
  saving?: boolean
  error?: string | null
  children?: React.ReactNode
}) {
  const valueColor = valueTone === 'ledger' ? 'var(--color-ledger)' : valueTone === 'muted' ? 'var(--color-neutral-500)' : 'var(--color-ink)'
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
            <button onClick={onSave} disabled={saving} className="m-btn m-btn-primary">{saving ? 'Saving...' : 'Save'}</button>
            <button onClick={onCancel} disabled={saving} className="m-btn m-btn-outline">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="m-setrow__side">
          <p className="text-[15px]" style={{ margin: 0, minWidth: 0, wordBreak: 'break-word', color: valueColor, fontWeight: valueTone === 'ledger' ? 600 : 400 }}>{value}</p>
          {action === 'FIXED' ? (
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--color-neutral-500)', whiteSpace: 'nowrap' }}>FIXED</span>
          ) : (
            <button onClick={onAction} disabled={actionDisabled} style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--color-ink)', whiteSpace: 'nowrap' }} className="hover:text-[var(--color-signal-text)] disabled:opacity-50">
              {action}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
