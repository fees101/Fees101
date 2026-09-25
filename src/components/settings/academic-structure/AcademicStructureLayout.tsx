'use client'

import { useState } from 'react'
import Link from 'next/link'
import SessionsTab from './SessionsTab'
import ClassesTable from './ClassesTable'
import { SessionRow } from '@/lib/queries/fees'
import Toast from '@/components/ui/Toast'
import { useCan } from '@/lib/auth/PermissionsProvider'

interface ClassRow {
  id: string
  name: string
  displayOrder: number
  isActive: boolean
  sectionId: string
  sectionName: string
  studentCount: number
  feeItemCount: number
  nextClassId?: string | null
}

interface Section {
  id: string
  name: string
}

interface TermLite {
  id: string
  name: string
  status: 'draft' | 'active' | 'closed'
  closeLabel: string | null
}

interface Summary {
  classesValue: string | null
  sessionValue: string | null
  currentTermValue: string | null
}

interface Props {
  classes: ClassRow[]
  sections: Section[]
  sessions: SessionRow[]
  termCounts: Record<string, number>
  activeSessionName: string | null
  terms: TermLite[]
  summary: Summary
  actorName: string
}

type DrillKey = 'classes' | 'session' | 'terms' | null

export default function AcademicStructureLayout({
  classes, sections, sessions, termCounts, activeSessionName, terms, summary, actorName,
}: Props) {
  const [drill, setDrill] = useState<DrillKey>(null)
  const [saved, setSaved] = useState<string | null>(null)
  // Sessions (create/set current/close) are actually gated on
  // manage-fee-structure server-side — see cycles/actions.ts's getContext()
  // default — not manage-academic-structure, which only covers classes/
  // sections. A classes-only holder (manage-academic-structure without
  // manage-fee-structure) can see this page but must not get an EDIT
  // affordance that fails on every click; hide it entirely, matching the
  // hidden-not-disabled pattern used elsewhere (e.g. FeeStructureLayout's
  // readOnly guards).
  const canManageSessions = useCan('manage-fee-structure')

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ borderTop: '2px solid var(--color-ink)', paddingTop: 18 }}>
        <h2 className="text-2xl font-extrabold tracking-[-0.015em] text-[var(--color-ink)]" style={{ margin: 0 }}>
          Academic structure
        </h2>
        <p className="text-[13px] text-[var(--color-neutral-800)]" style={{ maxWidth: '74ch', marginTop: 8 }}>
          Classes, sessions and terms. Changing these affects how students are grouped and billed.
        </p>
      </div>

      <div style={{ marginTop: 8 }}>
        <SettingRow
          label="Classes"
          desc="Ordered — promotion at year end follows this order"
          value={summary.classesValue || 'None yet'}
          valueTone={summary.classesValue ? 'ink' : 'muted'}
          actionLabel="MANAGE"
          onAction={() => setDrill('classes')}
        />
        <SettingRow
          label="Current session"
          desc="The academic year invoices belong to"
          value={summary.sessionValue || 'None set'}
          valueTone={summary.sessionValue ? 'ink' : 'ochre'}
          actionLabel={canManageSessions ? 'EDIT' : undefined}
          onAction={canManageSessions ? () => setDrill('session') : undefined}
        />
        <SettingRow
          label="Current term"
          desc="Where new invoices are generated"
          value={summary.currentTermValue || 'None active'}
          valueTone={summary.currentTermValue ? 'ink' : 'ochre'}
          actionLabel={canManageSessions ? 'MANAGE' : undefined}
          onAction={canManageSessions ? () => setDrill('terms') : undefined}
        />
      </div>

      {drill === 'classes' && (
        <DrillDrawer title="Classes" onClose={() => setDrill(null)} wide>
          <ClassesTable classes={classes} sections={sections} />
        </DrillDrawer>
      )}

      {drill === 'session' && (
        <DrillDrawer title="Current session" onClose={() => setDrill(null)}>
          <SessionsTab sessions={sessions} termCounts={termCounts} actorName={actorName} onClose={() => setDrill(null)} onSaved={setSaved} />
        </DrillDrawer>
      )}

      {drill === 'terms' && (
        <DrillDrawer title="Terms" onClose={() => setDrill(null)}>
          <TermsDrill terms={terms} sessionName={activeSessionName} />
        </DrillDrawer>
      )}

      {saved && (
        <Toast title="Change saved" message={saved} ok onDismiss={() => setSaved(null)} />
      )}
    </div>
  )
}

// Read-only list of the active session's terms, with the route to full CRUD.
// Terms are billing cycles, managed on the Billing cycles page — this ledger
// surfaces them and points there rather than duplicating that management here.
function TermsDrill({ terms, sessionName }: { terms: TermLite[]; sessionName: string | null }) {
  return (
    <div>
      <p className="text-[13px] text-[var(--color-neutral-700)] mb-4">
        Terms are billing cycles inside {sessionName ? `the ${sessionName} session` : 'the current session'}. Create, activate or close them on the Billing cycles page.
      </p>

      {terms.length === 0 ? (
        <p className="text-sm text-[var(--color-neutral-700)] py-4">No terms in this session yet.</p>
      ) : (
        <div className="border-t border-[var(--color-neutral-300)] mb-5">
          {terms.map(t => (
            <div key={t.id} className="flex items-center justify-between gap-4 py-3 border-b border-[var(--color-neutral-300)]">
              <span className="text-sm font-semibold text-[var(--color-ink)]">{t.name}</span>
              <span className="text-[13px] text-[var(--color-neutral-700)]">
                {t.status === 'active'
                  ? `Active${t.closeLabel ? ` · closes ${t.closeLabel}` : ''}`
                  : t.status === 'closed'
                    ? 'Closed'
                    : `Draft${t.closeLabel ? ` · closes ${t.closeLabel}` : ''}`}
              </span>
            </div>
          ))}
        </div>
      )}

      <Link href="/fees/cycles" className="m-btn m-btn-primary">Manage terms</Link>
    </div>
  )
}

type Tone = 'ink' | 'muted' | 'ochre'

// One ruled academic row, sharing the settings ledger geometry (.m-setrow):
// label + description left, current value on the aligned column, the action
// word flush right opening its drill-in.
function SettingRow({
  label, desc, value, valueTone, actionLabel, onAction, disabled,
}: {
  label: string
  desc: string
  value: string
  valueTone: Tone
  // Omit both to render a plain read-only row with no action affordance —
  // used when the viewer can see the value but lacks the permission the
  // underlying action actually requires (hidden, not disabled).
  actionLabel?: string
  onAction?: () => void
  disabled?: boolean
}) {
  const valueColor =
    valueTone === 'muted' ? 'var(--color-neutral-500)'
      : valueTone === 'ochre' ? 'var(--color-ochre-text)'
        : 'var(--color-ink)'
  return (
    <div className="m-setrow">
      <div style={{ minWidth: 0 }}>
        <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-ink)', margin: 0 }}>{label}</p>
        <p className="text-[13px] text-[var(--color-neutral-700)]" style={{ margin: '4px 0 0' }}>{desc}</p>
      </div>
      <div className="m-setrow__side">
        <p className="text-[15px]" style={{ margin: 0, minWidth: 0, wordBreak: 'break-word', color: valueColor, fontWeight: valueTone === 'ochre' ? 600 : 400 }}>{value}</p>
        {actionLabel && onAction && (
          <button
            onClick={onAction}
            disabled={disabled}
            style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--color-ink)', whiteSpace: 'nowrap', opacity: disabled ? 0.35 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}
            className="hover:text-[var(--color-signal-text)]"
          >
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  )
}

// Full-surface drill-in for a ledger row's management UI. Right-edge slide-over,
// same shell/chrome as FieldEditDrawer/FeeFormPanel (translucent backdrop, 2px
// ink left border, signal-red uppercase Close, slide-in from the right) —
// wider than the standard 420px field-edit drawer to hold a data table.
function DrillDrawer({ title, onClose, wide, children }: {
  title: string
  onClose: () => void
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="fixed inset-0 z-[60] flex m-anim-fade">
      <div
        className="flex-1 bg-[color-mix(in_srgb,var(--color-ink)_45%,transparent)]"
        onClick={onClose}
      />
      <aside
        style={{ width: wide ? 760 : 480, maxWidth: '100%' }}
        className="h-full overflow-y-auto bg-[var(--color-paper)] border-l-2 border-[var(--color-ink)] p-[22px] m-anim-slide"
      >
        <div className="flex items-baseline justify-between gap-3 mb-5">
          <h2 className="text-[22px] font-extrabold tracking-[-0.01em] text-[var(--color-ink)]">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--color-signal-text)] hover:underline"
          >
            Close
          </button>
        </div>
        {children}
      </aside>
    </div>
  )
}
