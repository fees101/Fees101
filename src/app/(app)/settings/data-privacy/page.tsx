import { redirect } from 'next/navigation'
import { getAuthContext } from '@/lib/auth/permissions'
import { getDataInventory, SUB_PROCESSORS } from '@/lib/dataPrivacy/inventory'
import {
  PRIVACY_POLICY_URL,
  TERMS_URL,
  PRIVACY_CONTACT_EMAIL,
  DELETION_GRACE_DAYS,
  FINANCIAL_RETENTION_YEARS,
} from '@/lib/dataPrivacy/config'
import SettingsPageShell from '@/components/settings/SettingsPageShell'
import ExportAllDataButton from '@/components/settings/ExportAllDataButton'

// Exporting/deleting a WHOLE SCHOOL's data is a different risk class from the
// rest of Settings — deliberately hardcoded to the owner (not a togglable
// permission), so a school can't accidentally hand this to a bursar by
// flipping on a settings-management permission.
export default async function DataPrivacySettingsPage() {
  const ctx = await getAuthContext()
  if (!ctx) redirect('/login')
  if (!ctx.isOwner) redirect('/dashboard')

  const inventory = ctx.schoolId ? await getDataInventory(ctx.schoolId) : []

  const card = 'bg-white border border-gray-200 rounded-xl p-5 sm:p-6'
  const h2 = 'text-lg font-semibold text-navy'
  const sub = 'text-sm text-gray-500 mt-1'

  return (
    <SettingsPageShell
      title="Data & privacy"
      subtitle="What we store, who it's shared with, and how to export or delete it"
    >
      <div className="flex flex-col gap-5 max-w-3xl">
        {/* ---- What we store ---- */}
        <section className={card}>
          <h2 className={h2}>What we store</h2>
          <p className={sub}>
            The information held for your school. This is what powers billing, reminders and reporting.
          </p>
          <dl className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {inventory.map(item => (
              <div key={item.key} className="border border-gray-100 rounded-lg p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-sm font-medium text-navy">{item.label}</dt>
                  <span className="text-sm font-semibold text-navy tabular-nums">
                    {item.count.toLocaleString()}
                  </span>
                </div>
                <dd className="text-xs text-gray-500 mt-1">{item.description}</dd>
                {item.detail && (
                  <dd className="text-xs text-gray-400 mt-1 tabular-nums">{item.detail}</dd>
                )}
              </div>
            ))}
          </dl>
        </section>

        {/* ---- Your privacy rights ---- */}
        <section className={card}>
          <h2 className={h2}>Your privacy rights</h2>
          <p className={sub}>
            Under the Nigeria Data Protection Act, you have the following rights over your school's data.
          </p>
          <ul className="mt-4 flex flex-col gap-3 text-sm">
            <li>
              <span className="font-medium text-navy">Access &amp; portability.</span>{' '}
              <span className="text-gray-600">Download a full copy of your data at any time — see “Export your data” below.</span>
            </li>
            <li>
              <span className="font-medium text-navy">Correction.</span>{' '}
              <span className="text-gray-600">
                Keep records accurate — edit student, parent and fee details directly on their pages in the app.
                For anything you can't change yourself, contact us.
              </span>
            </li>
            <li>
              <span className="font-medium text-navy">Deletion.</span>{' '}
              <span className="text-gray-600">
                Close your account and have your data erased — see “How long we keep it”.
              </span>
            </li>
          </ul>
        </section>

        {/* ---- Who it's shared with ---- */}
        <section className={card}>
          <h2 className={h2}>Who your data is shared with</h2>
          <p className={sub}>
            We use a small number of trusted providers to run the service. We never sell your data.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-400 border-b border-gray-100">
                  <th className="py-2 pr-4 font-medium">Provider</th>
                  <th className="py-2 pr-4 font-medium">Used for</th>
                  <th className="py-2 font-medium">Data involved</th>
                </tr>
              </thead>
              <tbody>
                {SUB_PROCESSORS.map(p => (
                  <tr key={p.name} className="border-b border-gray-50 last:border-0 align-top">
                    <td className="py-2 pr-4 font-medium text-navy whitespace-nowrap">{p.name}</td>
                    <td className="py-2 pr-4 text-gray-600">{p.purpose}</td>
                    <td className="py-2 text-gray-500">{p.data}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ---- How it's protected ---- */}
        <section className={card}>
          <h2 className={h2}>How your data is protected</h2>
          <ul className="mt-3 flex flex-col gap-2 text-sm text-gray-600">
            <li className="flex gap-2">
              <span className="text-mint">•</span>
              Encrypted in transit (HTTPS) and at rest in the database.
            </li>
            <li className="flex gap-2">
              <span className="text-mint">•</span>
              Role-based access — staff only see what their role permits, and every account is scoped to your school alone.
            </li>
            <li className="flex gap-2">
              <span className="text-mint">•</span>
              A full audit log records who changed what and when.
            </li>
          </ul>
        </section>

        {/* ---- Retention ---- */}
        <section className={card}>
          <h2 className={h2}>How long we keep it</h2>
          <p className="mt-2 text-sm text-gray-600">
            Your data is kept for as long as your account is active. If you close your account, personal
            data (students, parents and messages) is permanently deleted after a {DELETION_GRACE_DAYS}-day
            grace period. Financial records (invoices and payments) are kept in anonymised form — with no
            student or parent names — for {FINANCIAL_RETENTION_YEARS} years to meet tax and audit
            record-keeping requirements, then permanently deleted.
          </p>
        </section>

        {/* ---- Export ---- */}
        <section className={card}>
          <h2 className={h2}>Export your data</h2>
          <p className={sub}>
            Download everything held for your school as a set of spreadsheet files (one .zip). It's your
            data — you can take a copy at any time.
          </p>
          <div className="mt-4">
            <ExportAllDataButton />
          </div>
          <p className="text-xs text-gray-400 mt-3">
            Looking for a single report instead? Individual exports (debtors, collections, payments and
            more) are on the Reports page.
          </p>
        </section>

        {/* ---- Contact & policies ---- */}
        <section className={card}>
          <h2 className={h2}>Questions & policies</h2>
          <p className="mt-2 text-sm text-gray-600">
            For any data or privacy request, contact us at{' '}
            <a href={`mailto:${PRIVACY_CONTACT_EMAIL}`} className="text-navy font-medium underline">
              {PRIVACY_CONTACT_EMAIL}
            </a>
            .
          </p>
          <p className="mt-3 text-xs text-gray-500">
            Your school is the data controller for your students&apos; and parents&apos; information; Fees101
            is the data processor that stores and processes it on your behalf, so parents&apos; data requests
            should be directed to your school. Only essential cookies are used to keep you signed in — we
            don&apos;t use advertising or tracking cookies. You may also lodge a complaint with the Nigeria
            Data Protection Commission (NDPC).
          </p>
          <div className="mt-3 flex flex-wrap gap-4 text-sm">
            <a href={PRIVACY_POLICY_URL} target="_blank" rel="noopener noreferrer" className="text-navy underline">
              Privacy Policy
            </a>
            <a href={TERMS_URL} target="_blank" rel="noopener noreferrer" className="text-navy underline">
              Terms of Service
            </a>
          </div>
        </section>
      </div>
    </SettingsPageShell>
  )
}
