import { redirect } from 'next/navigation'
import { getAuthContext } from '@/lib/auth/permissions'
import { getDataInventory, SUB_PROCESSORS } from '@/lib/dataPrivacy/inventory'
import type { Metadata } from 'next'
import {
  PRIVACY_POLICY_URL,
  TERMS_URL,
  PRIVACY_CONTACT_EMAIL,
  DELETION_GRACE_DAYS,
  FINANCIAL_RETENTION_YEARS,
} from '@/lib/dataPrivacy/config'
import { getScheduledDeletion } from '@/lib/dataPrivacy/deletion'
import SettingsPageShell from '@/components/settings/SettingsPageShell'
import ExportAllDataButton from '@/components/settings/ExportAllDataButton'
import DeleteAccountSection from '@/components/settings/DeleteAccountSection'
import RealtimeRefresh from '@/components/realtime/RealtimeRefresh'
import AccessDenied from '@/components/layout/AccessDenied'

export const metadata: Metadata = { title: 'Data & privacy' }

// Exporting/deleting a WHOLE SCHOOL's data is a different risk class from the
// rest of Settings — deliberately hardcoded to the owner (not a togglable
// permission), so a school can't accidentally hand this to a bursar by
// flipping on a settings-management permission.
export default async function DataPrivacySettingsPage() {
  const ctx = await getAuthContext()
  if (!ctx) redirect('/login')
  if (!ctx.isOwner) {
    return (
      <SettingsPageShell workspaceKey="team" title="Data & privacy">
        <AccessDenied ctx={ctx} ownerOnly padded={false} />
      </SettingsPageShell>
    )
  }

  const [inventory, schoolRow, scheduledDeletion] = await Promise.all([
    ctx.schoolId ? getDataInventory(ctx.schoolId) : Promise.resolve([]),
    ctx.schoolId
      ? ctx.supabase.from('schools').select('name').eq('id', ctx.schoolId).single()
      : Promise.resolve({ data: null } as { data: { name: string } | null }),
    getScheduledDeletion(ctx.schoolId),
  ])
  const schoolName = schoolRow.data?.name ?? 'your school'
  const totalStudents = inventory.find(i => i.key === 'students')?.count ?? 0
  const totalInvoices = inventory.find(i => i.key === 'invoices')?.count ?? 0

  const h2 = 'text-lg font-extrabold tracking-[-0.01em] text-[var(--color-ink)]'
  const sub = 'text-[13px] text-[var(--color-neutral-700)] mt-1'

  return (
    <SettingsPageShell workspaceKey="team" title="Data & privacy">
      {ctx.schoolId && (
        // Live record counts drift as data changes; the scheduled-deletion
        // status is advanced by the background deletion job.
        <RealtimeRefresh
          subscriptions={[
            { table: 'students', filter: `school_id=eq.${ctx.schoolId}` },
            { table: 'invoices', filter: `school_id=eq.${ctx.schoolId}` },
            { table: 'payments', filter: `school_id=eq.${ctx.schoolId}` },
            { table: 'school_deletion_requests', filter: `school_id=eq.${ctx.schoolId}` },
          ]}
        />
      )}

      <div style={{ borderTop: '2px solid var(--color-ink)', paddingTop: 18 }}>
        <h2 className="text-2xl font-extrabold tracking-[-0.015em] text-[var(--color-ink)]" style={{ margin: 0 }}>
          Data and privacy
        </h2>
        <p className="text-[13px] text-[var(--color-neutral-800)]" style={{ maxWidth: '74ch', marginTop: 8 }}>
          The school owns its data. These controls are deliberately plain — each one has a real consequence
          stated in full.
        </p>
      </div>

      {/* ---- The consequence rows: export, who can, retention, close school ---- */}
      <div style={{ marginTop: 8 }}>
        <div className="m-setrow">
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-ink)', margin: 0 }}>Export everything</p>
            <p className="text-[13px] text-[var(--color-neutral-700)]" style={{ margin: '4px 0 0' }}>
              Students, invoices, payments and audit log as a set of CSV files (one .zip)
            </p>
          </div>
          <div className="m-setrow__side">
            <p className="text-[15px] text-[var(--color-ink)] m-num" style={{ margin: 0 }}>
              {totalStudents.toLocaleString()} students · {totalInvoices.toLocaleString()} invoices
            </p>
            <ExportAllDataButton variant="row" />
          </div>
        </div>

        <div className="m-setrow">
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-ink)', margin: 0 }}>Who can export</p>
            <p className="text-[13px] text-[var(--color-neutral-700)]" style={{ margin: '4px 0 0' }}>
              Exports carry parent phone numbers
            </p>
          </div>
          <div className="m-setrow__side">
            <p className="text-[15px] text-[var(--color-ink)]" style={{ margin: 0 }}>Owner only</p>
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--color-neutral-500)', whiteSpace: 'nowrap' }}>FIXED</span>
          </div>
        </div>

        <div className="m-setrow">
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-ink)', margin: 0 }}>Data retention</p>
            <p className="text-[13px] text-[var(--color-neutral-700)]" style={{ margin: '4px 0 0' }}>
              How long data is kept after the account closes
            </p>
          </div>
          <div className="m-setrow__side">
            <p className="text-[15px] text-[var(--color-ink)] m-num" style={{ margin: 0 }}>
              Personal data {DELETION_GRACE_DAYS} days · financial records {FINANCIAL_RETENTION_YEARS} years
            </p>
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--color-neutral-500)', whiteSpace: 'nowrap' }}>FIXED</span>
          </div>
        </div>

        <DeleteAccountSection
          schoolName={schoolName}
          graceDays={DELETION_GRACE_DAYS}
          retentionYears={FINANCIAL_RETENTION_YEARS}
          contactEmail={PRIVACY_CONTACT_EMAIL}
          scheduledFor={scheduledDeletion?.scheduledFor ?? null}
        />
      </div>

      {/* ---- What we store ---- */}
      <div className="m-panel">
        <h2 className={h2}>What we store</h2>
        <p className={sub}>
          The information held for your school. This is what powers billing, reminders and reporting.
        </p>
        <dl className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6">
          {inventory.map(item => (
            <div key={item.key} className="py-3 border-t border-[var(--color-neutral-300)]">
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-sm font-medium text-[var(--color-ink)]">{item.label}</dt>
                <span className="text-sm font-semibold text-[var(--color-ink)] m-num">
                  {item.count.toLocaleString()}
                </span>
              </div>
              <dd className="text-xs text-[var(--color-neutral-700)] mt-1">{item.description}</dd>
              {item.detail && (
                <dd className="text-xs text-[var(--color-neutral-500)] mt-1 m-num">{item.detail}</dd>
              )}
            </div>
          ))}
        </dl>
      </div>

      {/* ---- Your privacy rights ---- */}
      <div className="m-panel">
        <h2 className={h2}>Your privacy rights</h2>
        <p className={sub}>
          Under the Nigeria Data Protection Act, you have the following rights over your school&apos;s data.
        </p>
        <ul className="mt-4 flex flex-col gap-3 text-sm">
          <li>
            <span className="font-medium text-[var(--color-ink)]">Access &amp; portability.</span>{' '}
            <span className="text-[var(--color-neutral-700)]">Download a full copy of your data at any time — see &quot;Export everything&quot; above.</span>
          </li>
          <li>
            <span className="font-medium text-[var(--color-ink)]">Correction.</span>{' '}
            <span className="text-[var(--color-neutral-700)]">
              Keep records accurate — edit student, parent and fee details directly on their pages in the app.
              For anything you can&apos;t change yourself, contact us.
            </span>
          </li>
          <li>
            <span className="font-medium text-[var(--color-ink)]">Deletion.</span>{' '}
            <span className="text-[var(--color-neutral-700)]">
              Close your account and have your data erased — see &quot;Close this school&quot; above.
            </span>
          </li>
        </ul>
      </div>

      {/* ---- Who it's shared with ---- */}
      <div className="m-panel">
        <h2 className={h2}>Who your data is shared with</h2>
        <p className={sub}>
          We use a small number of trusted providers to run the service. We never sell your data.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="m-table">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Used for</th>
                <th>Data involved</th>
              </tr>
            </thead>
            <tbody>
              {SUB_PROCESSORS.map(p => (
                <tr key={p.name}>
                  <td className="font-medium text-[var(--color-ink)] whitespace-nowrap align-top">{p.name}</td>
                  <td className="text-[var(--color-neutral-700)] align-top">{p.purpose}</td>
                  <td className="text-[var(--color-neutral-700)] align-top">{p.data}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---- How it's protected ---- */}
      <div className="m-panel">
        <h2 className={h2}>How your data is protected</h2>
        <ul className="mt-3 flex flex-col gap-2 text-sm text-[var(--color-neutral-700)]">
          <li className="flex gap-2.5">
            <span aria-hidden className="mt-[7px] w-1.5 h-1.5 flex-shrink-0 bg-[var(--color-ink)]" />
            Encrypted in transit (HTTPS) and at rest in the database.
          </li>
          <li className="flex gap-2.5">
            <span aria-hidden className="mt-[7px] w-1.5 h-1.5 flex-shrink-0 bg-[var(--color-ink)]" />
            Role-based access — staff only see what their role permits, and every account is scoped to your school alone.
          </li>
          <li className="flex gap-2.5">
            <span aria-hidden className="mt-[7px] w-1.5 h-1.5 flex-shrink-0 bg-[var(--color-ink)]" />
            A full audit log records who changed what and when.
          </li>
        </ul>
      </div>

      {/* ---- Contact & policies ---- */}
      <div className="m-panel">
        <h2 className={h2}>Questions &amp; policies</h2>
        <p className="mt-2 text-sm text-[var(--color-neutral-700)]">
          For any data or privacy request, contact us at{' '}
          <a href={`mailto:${PRIVACY_CONTACT_EMAIL}`} className="text-[var(--color-ink)] font-medium underline">
            {PRIVACY_CONTACT_EMAIL}
          </a>
          .
        </p>
        <p className="mt-3 text-xs text-[var(--color-neutral-700)]">
          Your school is the data controller for your students&apos; and parents&apos; information; Fees101
          is the data processor that stores and processes it on your behalf, so parents&apos; data requests
          should be directed to your school. Only essential cookies are used to keep you signed in — we
          don&apos;t use advertising or tracking cookies. You may also lodge a complaint with the Nigeria
          Data Protection Commission (NDPC).
        </p>
        <div className="mt-3 flex flex-wrap gap-4 text-sm">
          <a href={PRIVACY_POLICY_URL} target="_blank" rel="noopener noreferrer" className="text-[var(--color-ink)] underline">
            Privacy Policy
          </a>
          <a href={TERMS_URL} target="_blank" rel="noopener noreferrer" className="text-[var(--color-ink)] underline">
            Terms of Service
          </a>
        </div>
      </div>
    </SettingsPageShell>
  )
}
