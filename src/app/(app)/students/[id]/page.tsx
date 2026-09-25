import { notFound, redirect } from 'next/navigation'
import type { Metadata } from 'next'
import WorkspaceHeader from '@/components/layout/WorkspaceHeader'
import StudentActivityTimeline from '@/components/students/StudentActivityTimeline'
import GenerateInvoiceButton from '@/components/students/GenerateInvoiceButton'
import EditRecordDrawer from '@/components/students/EditRecordDrawer'
import StudentFeesTab from '@/components/students/StudentFeesTab'
import HeaderVirtualAccount from '@/components/students/HeaderVirtualAccount'
import SendReminderButton from '@/components/students/SendReminderButton'
import ApplyDiscountButton from '@/components/students/ApplyDiscountButton'
import StudentRealtimeRefresh from '@/components/students/StudentRealtimeRefresh'
import AccessDenied from '@/components/layout/AccessDenied'
import { getStudentById, getStudentPaymentHistory, getStudentFees } from '@/lib/queries/students'
import { getDiscountSettings, mergeDiscountSettings } from '@/lib/queries/discounts'
import { getAuthContext, can } from '@/lib/auth/permissions'
import { formatDate } from '@/lib/format/date'

export const metadata: Metadata = { title: 'Student' }

interface PageProps {
  params: Promise<{ id: string }>
}

function formatNaira(amount: number): string {
  return '₦' + amount.toLocaleString('en-NG')
}

// Grid columns for the "Every term, every payment" ledger — one template shared
// by the header row and every data row so they line up. Inline (not a Tailwind
// class) because the WASM build drops arbitrary multi-minmax grid candidates.
const LEDGER_GRID = 'minmax(94px,1.4fr) minmax(70px,1fr) minmax(70px,1fr) minmax(80px,0.9fr)'
const LEDGER_LABEL = 'text-[11px] font-semibold tracking-[0.1em] text-[var(--color-neutral-700)]'

export default async function StudentDetailPage({ params }: PageProps) {
  const ctx = await getAuthContext()
  if (!ctx) redirect('/login')
  if (!can(ctx, 'see-students')) {
    return (
      <>
        <WorkspaceHeader workspaceKey="students" title="Student" back={{ href: '/students', label: 'Students' }} />
        <AccessDenied ctx={ctx} permissionKey="see-students" />
      </>
    )
  }

  const { id } = await params
  // All three datasets depend only on the id, not on one another — and every
  // panel of the single surface is visible at once, so all three are fetched
  // together on every load (read-only; no schema/server-action change).
  const [student, paymentHistory, feesData, discountSettings] = await Promise.all([
    getStudentById(id),
    getStudentPaymentHistory(id),
    getStudentFees(id),
    getDiscountSettings(),
  ])

  if (!student) {
    notFound()
  }

  const inv = student.currentInvoice
  const outstanding = inv
    ? inv.totalAmount - inv.paidAmount
    : (paymentHistory?.summary.outstanding ?? 0)
  // A running balance from overpayment/opt-out refund-in-kind — spent
  // automatically against this student's next generated invoice
  // (computeInvoice.ts), never shown to parents until then. Surfaced here so
  // staff know it exists rather than discovering it as a smaller-than-expected
  // invoice next term.
  const creditBalance = paymentHistory?.summary.unappliedCredit ?? 0

  // Status line under OUTSTANDING NOW. Green only where the term is fully paid
  // (money arrived); ochre where a human still owes; neutral when inert.
  let statusLabel: string
  let statusColor: string
  if (inv) {
    if (inv.status === 'paid') {
      statusLabel = 'Paid in full'
      statusColor = 'var(--color-ledger)'
    } else if (outstanding > 0) {
      statusLabel = inv.status === 'partial' ? 'Part-paid this term' : 'Not yet paid'
      statusColor = 'var(--color-ochre-text)'
    } else {
      statusLabel = 'Settled'
      statusColor = 'var(--color-neutral-700)'
    }
  } else if (outstanding > 0) {
    statusLabel = 'Owed from a past term'
    statusColor = 'var(--color-ochre-text)'
  } else {
    statusLabel = 'No invoice this term'
    statusColor = 'var(--color-neutral-700)'
  }

  const termLabel = (student.currentTermName || 'This term').toUpperCase()
  const invLabel = inv?.invoiceNumber ? ` · ${inv.invoiceNumber}` : ''

  // Record panel — status reads as uppercase colour-carrying text, never green
  // (green is reserved for money that arrived, per the design gate).
  const statusRecord =
    student.status === 'active'
      ? { label: 'ENROLLED', color: 'var(--color-ink)' }
      : student.status === 'withdrawn'
        ? { label: 'WITHDRAWN', color: 'var(--color-neutral-700)' }
        : { label: 'GRADUATED', color: 'var(--color-neutral-700)' }

  const siblingSuffix = student.siblingsTotalCount > 0
    ? ` · ${student.siblingsTotalCount + 1} children`
    : ''

  return (
    <>
      <StudentRealtimeRefresh studentId={student.id} />

      <WorkspaceHeader
        workspaceKey="students"
        title={`${student.firstName} ${student.lastName}`}
        back={{ href: '/students', label: 'Students' }}
      />

      <div className="px-4 sm:px-7 py-7 m-anim-fade">

        {/* Identity header: identity · outstanding · virtual account · actions */}
        <div
          style={{
            borderTop: '2px solid var(--color-ink)',
            paddingTop: 18,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
            gap: 24,
            alignItems: 'start',
          }}
        >
          <div className="min-w-0">
            <p className="text-[11px] tracking-[0.16em] text-[var(--color-neutral-700)] mb-2">
              {student.className} · {student.admissionNumber}
            </p>
            <h2 className="text-[30px] font-extrabold tracking-[-0.02em] leading-none mb-1.5 break-words">
              {student.firstName} {student.lastName}
            </h2>
            <p className="text-[14px] text-[var(--color-neutral-800)]">
              {student.family.primaryParentName} <span className="text-[var(--color-neutral-400)]">·</span>{' '}
              <span className="m-num">{student.family.primaryParentPhone}</span>
            </p>
          </div>

          <div>
            <p className="text-[11px] tracking-[0.16em] text-[var(--color-neutral-700)] mb-2">OUTSTANDING NOW</p>
            <p className="text-[34px] font-extrabold leading-[0.95] tracking-[-0.03em] mb-1 m-num">
              {formatNaira(outstanding)}
            </p>
            <p className="text-[13px] font-semibold" style={{ color: statusColor }}>{statusLabel}</p>
            {creditBalance > 0 && (
              <p className="text-[13px] font-semibold m-num mt-1" style={{ color: 'var(--color-ledger)' }}>
                {formatNaira(creditBalance)} credit on file
              </p>
            )}
          </div>

          <HeaderVirtualAccount
            studentId={student.id}
            providerConfigured={student.virtualAccount.providerConfigured}
            hasAccount={student.virtualAccount.hasAccount}
            accountNumber={student.virtualAccount.accountNumber}
            bankName={student.virtualAccount.bankName}
          />

          <div className="flex flex-col gap-2 items-stretch">
            <SendReminderButton
              studentId={student.id}
              needsResend={inv?.needsResend}
              sentAt={inv?.sentAt}
              status={inv?.status}
            />
            <ApplyDiscountButton
              currentInvoiceId={inv?.id ?? null}
              currentInvoiceSubtotal={inv?.subtotal}
              currentInvoiceDiscountAmount={inv?.discountAmount}
              discounts={inv?.revocableDiscounts ?? student.fallbackDiscounts}
              canAddDiscount={inv?.canAddDiscount ?? false}
              canFullyRevoke={inv?.canFullyRevokeDiscount ?? student.fallbackCanFullyRevoke}
              discountSettings={discountSettings ?? mergeDiscountSettings('', undefined)}
              autoApproveThreshold={discountSettings?.approval.thresholdNaira ?? null}
            />
          </div>
        </div>

        {/* Two-column body: ledger (1.5fr) beside activity/record (1fr) */}
        <div className="m-2col-profile mt-7">

          {/* Left column */}
          <div>

            {/* This term */}
            <div className="m-panel">
              <div className="flex items-baseline justify-between gap-3 mb-1">
                <h3 className="text-[22px] font-extrabold">This term</h3>
                <span className="text-[12px] tracking-[0.08em] text-[var(--color-neutral-700)]">{termLabel}{invLabel}</span>
              </div>
              <p className="text-[14px] text-[var(--color-neutral-800)] mb-3.5">
                What was billed, and what has been paid against it.
              </p>

              {!inv ? (
                <div className="py-10 text-center border-2 border-dashed border-[var(--color-neutral-300)]">
                  <p className="text-sm text-[var(--color-neutral-700)] mb-4">No invoice generated for this term yet.</p>
                  <GenerateInvoiceButton
                    studentId={student.id}
                    studentName={`${student.firstName} ${student.lastName}`}
                    cycleId={student.currentCycleId}
                  />
                </div>
              ) : (
                <>
                  {(inv.lineItems as Array<{ name: string, amount: number }>).map((item, idx) => (
                    <div
                      key={idx}
                      className="grid gap-3.5 items-baseline py-2.5 border-t border-[var(--color-neutral-300)]"
                      style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}
                    >
                      <span className="text-[14px] text-[var(--color-ink)]">{item.name}</span>
                      <span className="text-[14px] m-num text-right text-[var(--color-ink)]" style={{ minWidth: 96 }}>
                        {formatNaira(Number(item.amount))}
                      </span>
                    </div>
                  ))}

                  {inv.discountAmount > 0 && (
                    <div
                      className="grid gap-3.5 items-baseline py-2.5 border-t border-[var(--color-neutral-300)]"
                      style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}
                    >
                      <span className="text-[14px] text-[var(--color-neutral-800)]">
                        Discount
                        {inv.discountReason && (
                          <span className="block text-[12px] text-[var(--color-neutral-700)]">{inv.discountReason}</span>
                        )}
                      </span>
                      <span className="text-[14px] m-num text-right text-[var(--color-ink)]" style={{ minWidth: 96 }}>
                        − {formatNaira(inv.discountAmount)}
                      </span>
                    </div>
                  )}

                  <div
                    className="grid gap-3.5 py-3"
                    style={{ gridTemplateColumns: 'minmax(0,1fr) auto', borderTop: '2px solid var(--color-ink)' }}
                  >
                    <span className="text-[14px] font-extrabold">Total billed</span>
                    <span className="text-[16px] font-extrabold m-num text-right">{formatNaira(inv.totalAmount)}</span>
                  </div>

                  <div
                    className="grid gap-3.5 py-2.5 border-t border-[var(--color-neutral-300)]"
                    style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}
                  >
                    <span className="text-[14px] text-[var(--color-neutral-800)]">Paid so far</span>
                    <span
                      className="text-[14px] font-semibold m-num text-right"
                      style={{ color: inv.paidAmount > 0 ? 'var(--color-ledger)' : 'var(--color-neutral-700)' }}
                    >
                      {inv.paidAmount > 0 ? '− ' : ''}{formatNaira(inv.paidAmount)}
                    </span>
                  </div>

                  <div
                    className="grid gap-3.5 pt-3 border-t border-[var(--color-neutral-300)]"
                    style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}
                  >
                    <span className="text-[15px] font-extrabold">Still to pay</span>
                    <span
                      className="text-[20px] font-extrabold m-num text-right"
                      style={{ color: outstanding > 0 ? 'var(--color-ochre-text)' : 'var(--color-neutral-700)' }}
                    >
                      {formatNaira(outstanding)}
                    </span>
                  </div>
                </>
              )}
            </div>

            {/* Every term, every payment */}
            <div className="m-panel">
              <h3 className="text-[22px] font-extrabold mb-1">Every term, every payment</h3>
              <p className="text-[14px] text-[var(--color-neutral-800)] mb-3.5" style={{ maxWidth: '62ch' }}>
                Every term of history as one continuous ledger rather than a stack of expandable cards — read down a
                column to see whether this family usually pays on time.
              </p>

              {!paymentHistory || paymentHistory.invoices.length === 0 ? (
                <p className="text-sm text-[var(--color-neutral-700)] py-2">No invoices yet for this student.</p>
              ) : (
                <div className="overflow-x-auto">
                  <div
                    className="grid gap-2.5 pb-2"
                    style={{ gridTemplateColumns: LEDGER_GRID, minWidth: 380, borderBottom: '2px solid var(--color-ink)' }}
                  >
                    <span className={LEDGER_LABEL}>TERM</span>
                    <span className={`${LEDGER_LABEL} text-right`}>BILLED</span>
                    <span className={`${LEDGER_LABEL} text-right`}>PAID</span>
                    <span className={`${LEDGER_LABEL} text-right`}>SETTLED</span>
                  </div>
                  {paymentHistory.invoices.map(row => {
                    const settled = row.status === 'paid'
                    return (
                      <div
                        key={row.id}
                        className="grid gap-2.5 items-baseline py-[11px] border-b border-[var(--color-neutral-300)]"
                        style={{ gridTemplateColumns: LEDGER_GRID, minWidth: 380 }}
                      >
                        <span className="text-[14px] font-semibold">{row.termName}</span>
                        <span className="text-[14px] text-right m-num text-[var(--color-neutral-800)]">{formatNaira(row.totalAmount)}</span>
                        <span
                          className="text-[14px] text-right m-num"
                          style={{ color: row.paidAmount > 0 ? 'var(--color-ledger)' : 'var(--color-neutral-700)' }}
                        >
                          {formatNaira(row.paidAmount)}
                        </span>
                        <span
                          className="text-[13px] text-right m-num"
                          style={{ color: settled ? 'var(--color-neutral-700)' : 'var(--color-ochre-text)' }}
                        >
                          {settled ? formatDate(row.fullyPaidAt) : 'Owing'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Fees management re-homed here from the former Fees tab. Kept in
                the left column, right after this term's ledger, rather than
                below the whole two-column row — the right column (Activity +
                Record + Siblings) can run much taller than this column for a
                large family, and a sibling-after-the-grid element would then
                render below the taller column instead of this one, leaving a
                dead gap under "Every term, every payment" with the fee
                structure pushed out of view. */}
            <div className="m-panel mt-7">
              <h3 className="text-[22px] font-extrabold mb-1">Fees this term</h3>
              <p className="text-[14px] text-[var(--color-neutral-800)] mb-5">
                Manage what this student is billed, and generate or update the invoice.
              </p>
              {feesData ? (
                <StudentFeesTab data={feesData} />
              ) : (
                <p className="text-[14px] text-[var(--color-signal-text)]">
                  Couldn't load this student's fees. Refresh the page — if it keeps happening, contact support.
                </p>
              )}
            </div>

          </div>

          {/* Right column */}
          <div>
            <StudentActivityTimeline
              studentId={student.id}
              studentName={`${student.firstName} ${student.lastName}`}
              parentName={student.family.primaryParentName}
            />

            {/* Record */}
            <div className="m-panel">
              <h3 className="text-[18px] font-extrabold mb-1">Record</h3>
              <p className="text-[13px] text-[var(--color-neutral-800)] mb-3">
                Everything editable about this student, in one place.
              </p>

              <RecordRow label="Status">
                <span className="text-[12px] font-semibold uppercase" style={{ color: statusRecord.color, letterSpacing: '0.08em' }}>
                  {statusRecord.label}
                </span>
              </RecordRow>
              <RecordRow label="Class">
                <span className="text-[13px]">{student.className || '—'}</span>
              </RecordRow>
              <RecordRow label="Family">
                <span className="text-[13px]">{student.family.primaryParentName}{siblingSuffix}</span>
              </RecordRow>
              <RecordRow label="Admitted">
                <span className="text-[13px] m-num">{formatDate(student.admissionDate)}</span>
              </RecordRow>
              <RecordRow label="Notes">
                <span className="text-[13px] text-right" style={{ color: student.family.notes ? 'var(--color-ink)' : 'var(--color-neutral-500)' }}>
                  {student.family.notes ? student.family.notes : 'None'}
                </span>
              </RecordRow>

              <EditRecordDrawer student={student} />
            </div>

            {/* Siblings — re-homed from the former family panel; each links to
                its own profile, with this term's invoice state as colour text. */}
            {student.siblings.length > 0 && (
              <div className="m-panel">
                <h3 className="text-[18px] font-extrabold mb-1">Siblings</h3>
                <p className="text-[13px] text-[var(--color-neutral-800)] mb-3">
                  {student.siblingsTotalCount} other{student.siblingsTotalCount === 1 ? '' : 's'} in this family, and where they stand this term.
                </p>
                {/* Capped so a large family (this list already caps at
                    SIBLINGS_LIMIT=20) scrolls inside its own panel instead of
                    stretching the whole right column past the left column's
                    content. */}
                <div className="overflow-y-auto" style={{ maxHeight: 420 }}>
                {student.siblings.map(sib => {
                  const sc = sib.invoiceStatus === 'paid'
                    ? { label: 'Paid', color: 'var(--color-ledger)' }
                    : sib.invoiceStatus === 'partial'
                      ? { label: 'Partial', color: 'var(--color-ochre-text)' }
                      : sib.invoiceStatus === 'pending'
                        ? { label: 'Unpaid', color: 'var(--color-ochre-text)' }
                        : { label: 'No invoice', color: 'var(--color-neutral-700)' }
                  return (
                    <a
                      key={sib.id}
                      href={`/students/${sib.id}`}
                      className="grid gap-2.5 items-baseline py-2.5 border-t border-[var(--color-neutral-300)] hover:bg-[color-mix(in_srgb,var(--color-ink)_4%,transparent)]"
                      style={{ gridTemplateColumns: '1fr auto' }}
                    >
                      <span className="min-w-0">
                        <span className="text-[13px] font-semibold text-[var(--color-ink)]">{sib.firstName} {sib.lastName}</span>
                        {sib.className && <span className="text-[12px] text-[var(--color-neutral-700)]"> · {sib.className}</span>}
                      </span>
                      <span className="text-[12px] font-semibold uppercase" style={{ color: sc.color, letterSpacing: '0.08em' }}>{sc.label}</span>
                    </a>
                  )
                })}
                {student.siblingsTotalCount > student.siblings.length && (
                  <p className="text-[12px] text-[var(--color-neutral-700)] pt-2.5 border-t border-[var(--color-neutral-300)]">
                    +{student.siblingsTotalCount - student.siblings.length} more not shown
                  </p>
                )}
                </div>
              </div>
            )}
          </div>

        </div>
      </div>
    </>
  )
}

// A hairline-topped label/value row for the Record panel (grid 1fr / auto).
function RecordRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      className="grid gap-2.5 py-2.5 items-baseline border-t border-[var(--color-neutral-300)]"
      style={{ gridTemplateColumns: '1fr auto' }}
    >
      <span className="text-[13px] text-[var(--color-neutral-800)]">{label}</span>
      {children}
    </div>
  )
}
