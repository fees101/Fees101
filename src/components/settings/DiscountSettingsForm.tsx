'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { saveDiscountSettings } from '@/app/(app)/school/discounts/actions'
import type { DiscountSettings, SiblingTier, ApproverRole } from '@/lib/queries/discounts'
import FieldEditDrawer, { SectionLabel, CheckList, ChoiceList } from '@/components/settings/FieldEditDrawer'
import Toast from '@/components/ui/Toast'

interface Props {
  settings: DiscountSettings
  actorName: string
}

type EditKey = 'sibling' | 'staff' | 'approvers' | 'threshold'

// Same square-edged toggle used on Reminders (ReminderSettingsForm.tsx) —
// no rounded pill, ink when on, matching the Modernist styling elsewhere.
function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center border-2 transition-colors ${
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

const ROW_LABELS: Record<EditKey, string> = {
  sibling: 'Sibling discount',
  staff: 'Staff children',
  approvers: 'Who can approve',
  threshold: 'Approval threshold',
}

function tierLabel(index: number): string {
  const ordinals = ['2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th']
  return `${ordinals[index] || `${index + 2}th`} child`
}

function fmtTier(t: SiblingTier): string {
  return t.isPercentage ? `${t.value}% off` : `₦${t.value.toLocaleString('en-NG')} off`
}

export default function DiscountSettingsForm({ settings, actorName }: Props) {
  const router = useRouter()

  const [form, setForm] = useState({
    siblingTiers: settings.siblingTiers,
    staffDiscountDefaultPct: settings.staffDiscountDefaultPct,
    staffDiscountScope: settings.staffDiscountScope,
    approverRoles: settings.approval.approverRoles,
    thresholdEnabled: settings.approval.thresholdNaira !== null,
    thresholdNaira: settings.approval.thresholdNaira ?? 100000,
  })
  const [snapshot, setSnapshot] = useState(form)
  const [editing, setEditing] = useState<EditKey | null>(null)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  function update(patch: Partial<typeof form>) {
    setForm(f => ({ ...f, ...patch }))
  }

  function openEdit(key: EditKey) {
    setSnapshot(form)
    setReason('')
    setError(null)
    // The sibling editor needs at least one editable row to show; seed one when
    // the school currently has no tiers configured.
    if (key === 'sibling' && form.siblingTiers.length === 0) {
      setForm(f => ({ ...f, siblingTiers: [{ value: 10, isPercentage: true }] }))
    }
    setEditing(key)
  }

  function cancelEdit() {
    setForm(snapshot)
    setEditing(null)
    setError(null)
  }

  async function saveEdit() {
    setError(null)
    setSaving(true)
    const result = await saveDiscountSettings({
      siblingTiers: form.siblingTiers,
      staffDiscountDefaultPct: Number(form.staffDiscountDefaultPct),
      staffDiscountScope: form.staffDiscountScope,
      approval: {
        approverRoles: form.approverRoles,
        thresholdNaira: form.thresholdEnabled ? Number(form.thresholdNaira) : null,
      },
      reason: reason.trim() || undefined,
    })
    setSaving(false)
    if (result.error) return setError(result.error)
    setSaved(editing ? ROW_LABELS[editing] : null)
    setEditing(null)
    router.refresh()
  }

  // Sibling tier editing helpers ------------------------------------------
  function updateTier(index: number, patch: Partial<SiblingTier>) {
    const next = [...form.siblingTiers]
    next[index] = { ...next[index], ...patch }
    update({ siblingTiers: next })
  }
  function addTier() {
    const last = form.siblingTiers[form.siblingTiers.length - 1]
    update({ siblingTiers: [...form.siblingTiers, { value: last ? last.value : 10, isPercentage: true }] })
  }
  function removeTier(index: number) {
    update({ siblingTiers: form.siblingTiers.filter((_, i) => i !== index) })
  }
  function toggleRole(role: ApproverRole, on: boolean) {
    const set = new Set(form.approverRoles)
    if (on) set.add(role); else set.delete(role)
    set.add('school_admin') // Owner always qualifies
    update({ approverRoles: Array.from(set) })
  }

  // Derived value strings --------------------------------------------------
  const siblingValue = form.siblingTiers.length === 0
    ? 'Off'
    : form.siblingTiers.length === 1
      ? fmtTier(form.siblingTiers[0])
      : `${fmtTier(form.siblingTiers[0])} +${form.siblingTiers.length - 1} more`

  const staffScopeLabel = form.staffDiscountScope === 'full_invoice' ? 'overall invoice' : 'discountable fees only'
  const staffValue = form.staffDiscountDefaultPct > 0 ? `${form.staffDiscountDefaultPct}% off · ${staffScopeLabel}` : 'Off'

  const roleNames = form.approverRoles.includes('bursar') ? ['Owner', 'Bursar'] : ['Owner']
  const approversValue = roleNames.length === 2 ? 'Owner and Bursar' : 'Owner'

  const thresholdValue = form.thresholdEnabled ? `₦${Number(form.thresholdNaira).toLocaleString('en-NG')}` : 'No threshold'

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ borderTop: '2px solid var(--color-ink)', paddingTop: 18 }}>
        <h2 className="text-2xl font-extrabold tracking-[-0.015em] text-[var(--color-ink)]" style={{ margin: 0 }}>
          Discount policy
        </h2>
        <p className="text-[13px] text-[var(--color-neutral-800)]" style={{ maxWidth: '74ch', marginTop: 8 }}>
          The rules that create discounts automatically, and who is allowed to approve the rest.
        </p>
      </div>

      <div style={{ marginTop: 8 }}>
        <SettingRow
          label="Sibling discount"
          desc="Applied from the second child in a family"
          value={siblingValue}
          valueTone={form.siblingTiers.length ? 'ink' : 'muted'}
          onEdit={() => openEdit('sibling')}
        />
        <SettingRow
          label="Staff children"
          desc="Applied to children of any staff member"
          value={staffValue}
          valueTone={form.staffDiscountDefaultPct > 0 ? 'ink' : 'muted'}
          onEdit={() => openEdit('staff')}
        />
        <SettingRow
          label="Who can approve"
          desc="Roles allowed to grant a discount"
          value={approversValue}
          valueTone="ink"
          onEdit={() => openEdit('approvers')}
        />
        <SettingRow
          label="Approval threshold"
          desc="Below this, a discount is granted automatically"
          value={thresholdValue}
          valueTone={form.thresholdEnabled ? 'ink' : 'muted'}
          onEdit={() => openEdit('threshold')}
        />
      </div>

      {editing === 'sibling' && (
        <FieldEditDrawer
          title="Sibling discount"
          subtitle="Applied from the second child in a family"
          currentDisplay={siblingValue}
          reason={reason}
          onReasonChange={setReason}
          actorName={actorName}
          onClose={cancelEdit}
          onSave={saveEdit}
          saving={saving}
          error={error}
        >
          <div style={{ marginBottom: 16 }}>
            <SectionLabel>New rate</SectionLabel>
            <p className="text-[13px] text-[var(--color-neutral-700)]" style={{ margin: '0 0 10px' }}>
              The oldest enrolled child is always full price. Add a rate for each additional child.
            </p>
            <div style={{ border: '2px solid var(--color-ink)', background: '#fff' }}>
              {form.siblingTiers.map((tier, i) => (
                <div
                  key={i}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--color-neutral-300)' }}
                >
                  <span className="text-[14px]" style={{ fontWeight: 600, color: 'var(--color-ink)', width: 74 }}>{tierLabel(i)}</span>
                  <input
                    type="number" min={0} max={100} value={tier.value}
                    onChange={(e) => updateTier(i, { value: Number(e.target.value) })}
                    className="m-input m-num"
                    style={{ width: 70, textAlign: 'right' }}
                  />
                  <span className="text-[13px] text-[var(--color-neutral-700)]">% off</span>
                  <button
                    type="button"
                    onClick={() => removeTier(i)}
                    style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-neutral-500)' }}
                    className="hover:text-[var(--color-signal-text)]"
                    aria-label="Remove tier"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <button type="button" onClick={addTier} className="text-sm font-semibold text-[var(--color-ink)] hover:underline" style={{ marginTop: 10 }}>
              + Add another tier
            </button>
          </div>
        </FieldEditDrawer>
      )}

      {editing === 'staff' && (
        <FieldEditDrawer
          title="Staff children"
          subtitle="Applied to children of any staff member"
          currentDisplay={staffValue}
          reason={reason}
          onReasonChange={setReason}
          actorName={actorName}
          onClose={cancelEdit}
          onSave={saveEdit}
          saving={saving}
          error={error}
          note="This is the rate actually applied when a staff-child discount is requested — there's no way to type a different amount at request time."
        >
          <div style={{ marginBottom: 16 }}>
            <SectionLabel>New rate</SectionLabel>
            <div className="flex items-center gap-2">
              <input
                type="number" min={0} max={100} value={form.staffDiscountDefaultPct}
                onChange={(e) => update({ staffDiscountDefaultPct: Number(e.target.value) })}
                className="m-input m-num"
                style={{ width: 80, textAlign: 'right' }}
              />
              <span className="text-[13px] text-[var(--color-neutral-700)]">% off</span>
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <SectionLabel>Applies to</SectionLabel>
            <ChoiceList
              value={form.staffDiscountScope}
              onChange={(v) => update({ staffDiscountScope: v })}
              options={[
                { value: 'discountable_only', label: 'Discountable fees only' },
                { value: 'full_invoice', label: 'Overall invoice' },
              ]}
            />
          </div>
        </FieldEditDrawer>
      )}

      {editing === 'approvers' && (
        <FieldEditDrawer
          title="Who can approve"
          subtitle="Roles allowed to grant a discount"
          currentDisplay={approversValue}
          reason={reason}
          onReasonChange={setReason}
          actorName={actorName}
          onClose={cancelEdit}
          onSave={saveEdit}
          saving={saving}
          error={error}
          note="The Owner can always approve. Choose whether the Bursar can too."
        >
          <div style={{ marginBottom: 16 }}>
            <SectionLabel>Tick everyone allowed</SectionLabel>
            <CheckList
              value={form.approverRoles.includes('bursar') ? ['school_admin', 'bursar'] : ['school_admin']}
              onChange={(next) => toggleRole('bursar', next.includes('bursar'))}
              options={[
                { value: 'school_admin', label: 'Owner', locked: true },
                { value: 'bursar', label: 'Bursar' },
              ]}
            />
          </div>
        </FieldEditDrawer>
      )}

      {editing === 'threshold' && (
        <FieldEditDrawer
          title="Approval threshold"
          subtitle="Below this, a discount is granted automatically"
          currentDisplay={thresholdValue}
          reason={reason}
          onReasonChange={setReason}
          actorName={actorName}
          onClose={cancelEdit}
          onSave={saveEdit}
          saving={saving}
          error={error}
          note="A discount above this amount still waits for someone with approval permission. Either way, you can review and revoke a granted discount afterwards from the Discounts page."
        >
          <div style={{ marginBottom: 16 }}>
            <SectionLabel>New value</SectionLabel>
            <div className="flex items-center gap-3" style={{ padding: '10px 0' }}>
              <Switch
                checked={form.thresholdEnabled}
                onChange={(v) => update({ thresholdEnabled: v })}
                label="Auto-approve discounts below an amount"
              />
              <span className="text-[14px]" style={{ color: 'var(--color-ink)' }}>Auto-approve discounts below an amount</span>
            </div>
            <div
              className="flex items-center gap-2"
              style={{ opacity: form.thresholdEnabled ? 1 : 0.4, pointerEvents: form.thresholdEnabled ? 'auto' : 'none' }}
            >
              <span className="text-[13px] text-[var(--color-neutral-700)]">₦</span>
              <input
                type="number" min={0} step={1000} value={form.thresholdNaira}
                disabled={!form.thresholdEnabled}
                onChange={(e) => update({ thresholdNaira: Number(e.target.value) })}
                className="m-input m-num"
                style={{ width: 160, textAlign: 'right' }}
              />
            </div>
          </div>
        </FieldEditDrawer>
      )}

      {saved && (
        <Toast title="Change saved" message={`${saved} — recorded in the audit log.`} ok onDismiss={() => setSaved(null)} />
      )}
    </div>
  )
}

// One ruled discount-policy row, sharing the School-profile ledger geometry
// (.m-setrow): label + description left, current value on the aligned column,
// EDIT flush right, opening the matching FieldEditDrawer.
function SettingRow({
  label, desc, value, valueTone, onEdit,
}: {
  label: string
  desc: string
  value: string
  valueTone: 'ink' | 'muted'
  onEdit: () => void
}) {
  const valueColor = valueTone === 'muted' ? 'var(--color-neutral-500)' : 'var(--color-ink)'
  return (
    <div className="m-setrow">
      <div style={{ minWidth: 0 }}>
        <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-ink)', margin: 0 }}>{label}</p>
        <p className="text-[13px] text-[var(--color-neutral-700)]" style={{ margin: '4px 0 0' }}>{desc}</p>
      </div>
      <div className="m-setrow__side">
        <p className="text-[15px]" style={{ margin: 0, minWidth: 0, wordBreak: 'break-word', color: valueColor }}>{value}</p>
        <button onClick={onEdit} style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--color-ink)', whiteSpace: 'nowrap' }} className="hover:text-[var(--color-signal-text)]">EDIT</button>
      </div>
    </div>
  )
}
