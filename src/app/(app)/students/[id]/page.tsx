import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import StudentActivityTimeline from '@/components/students/StudentActivityTimeline'
import StudentSettingsTab from '@/components/students/StudentSettingsTab'
import StudentPaymentHistoryTab from '@/components/students/StudentPaymentHistoryTab'
import StudentFeesTab from '@/components/students/StudentFeesTab'
import HeaderVirtualAccount from '@/components/students/HeaderVirtualAccount'
import SendReminderButton from '@/components/students/SendReminderButton'
import ApplyDiscountButton from '@/components/students/ApplyDiscountButton'
import { getStudentById, getStudentPaymentHistory, getStudentFees } from '@/lib/queries/students'
import { getAuthContext, can } from '@/lib/auth/permissions'

interface PageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string }>
}

function formatNaira(amount: number): string {
  return '₦' + amount.toLocaleString('en-NG')
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

function getInitials(firstName: string, lastName: string): string {
  return (firstName[0] + lastName[0]).toUpperCase()
}

export default async function StudentDetailPage({ params, searchParams }: PageProps) {
  const ctx = await getAuthContext()
  if (!ctx) redirect('/login')
  if (!can(ctx, 'see-students')) redirect('/dashboard')

  const { id } = await params
  const { tab } = await searchParams
  const activeTab = tab === 'settings' ? 'settings' : tab === 'payments' ? 'payments' : tab === 'fees' ? 'fees' : 'overview'
  // The student and whichever tab-specific dataset is active depend only on
  // the id, not on one another — fetch them together.
  const [student, paymentHistory, feesData] = await Promise.all([
    getStudentById(id),
    activeTab === 'payments' ? getStudentPaymentHistory(id) : Promise.resolve(null),
    activeTab === 'fees' ? getStudentFees(id) : Promise.resolve(null),
  ])

  if (!student) {
    notFound()
  }

  const initials = getInitials(student.firstName, student.lastName)
  const outstanding = student.currentInvoice 
    ? student.currentInvoice.totalAmount - student.currentInvoice.paidAmount 
    : 0
  const collectionPercentage = student.currentInvoice && student.currentInvoice.totalAmount > 0
    ? Math.round((student.currentInvoice.paidAmount / student.currentInvoice.totalAmount) * 100)
    : 0

  return (
    <main className="px-6 py-6">
      <div className="max-w-[1440px] mx-auto">
        
        {/* Breadcrumb */}
        <nav className="mb-4 flex items-center gap-2 text-sm text-gray-500">
          <Link href="/students" className="hover:text-navy">Students</Link>
          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-navy font-medium">{student.firstName} {student.lastName}</span>
        </nav>

        {/* Header card */}
        <div className="bg-white p-6 rounded-xl border border-gray-200 mb-6">
          <div className="flex items-start justify-between gap-6">
            
            <div className="flex items-start gap-4 flex-1">
              <div className="w-20 h-20 rounded-full bg-mint-light flex items-center justify-center flex-shrink-0">
                <span className="text-navy text-2xl font-bold">{initials}</span>
              </div>
              <div>
                <h1 className="text-3xl font-bold text-navy">
                  {student.firstName} {student.lastName}
                </h1>
                <p className="text-sm text-gray-500 mt-1">
                  {student.className} · Admission #{student.admissionNumber} · Enrolled {formatDate(student.admissionDate)}
                </p>
                <span className="inline-flex items-center gap-1 mt-3 px-3 py-1 text-xs font-medium bg-mint-light text-mint rounded-full">
                  <span className="w-1.5 h-1.5 bg-mint rounded-full"></span>
                  {student.status === 'active' ? 'Active' : student.status}
                </span>
              </div>
            </div>

            <div className="border-l border-gray-200 pl-6">
              <HeaderVirtualAccount
                studentId={student.id}
                providerConfigured={student.virtualAccount.providerConfigured}
                hasAccount={student.virtualAccount.hasAccount}
                accountNumber={student.virtualAccount.accountNumber}
                bankName={student.virtualAccount.bankName}
              />
            </div>

            <div className="flex flex-col gap-2">
              <SendReminderButton
                studentId={student.id}
                needsResend={student.currentInvoice?.needsResend}
                sentAt={student.currentInvoice?.sentAt}
                status={student.currentInvoice?.status}
              />
              <ApplyDiscountButton
                currentInvoiceId={student.currentInvoice?.id ?? null}
                discounts={student.currentInvoice?.revocableDiscounts ?? []}
                canAddDiscount={student.currentInvoice?.canAddDiscount ?? false}
                canFullyRevoke={student.currentInvoice?.canFullyRevokeDiscount ?? false}
              />
            </div>

          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200 mb-6">
          <div className="flex gap-6">
            <Link 
              href={`/students/${id}`}
              className={`px-1 py-3 text-sm font-medium ${activeTab === 'overview' ? 'text-navy border-b-2 border-mint' : 'text-gray-500 hover:text-navy'}`}
            >
              Overview
            </Link>
            <Link 
              href={`/students/${id}?tab=payments`}
              className={`px-1 py-3 text-sm font-medium ${activeTab === 'payments' ? 'text-navy border-b-2 border-mint' : 'text-gray-500 hover:text-navy'}`}
            >
              Payment History
            </Link>
            <Link 
              href={`/students/${id}?tab=fees`}
              className={`px-1 py-3 text-sm font-medium ${activeTab === 'fees' ? 'text-navy border-b-2 border-mint' : 'text-gray-500 hover:text-navy'}`}
            >
              Fees
            </Link>
            <Link 
              href={`/students/${id}?tab=settings`}
              className={`px-1 py-3 text-sm font-medium ${activeTab === 'settings' ? 'text-navy border-b-2 border-mint' : 'text-gray-500 hover:text-navy'}`}
            >
              Settings
            </Link>
          </div>
        </div>

          {activeTab === 'overview' && (
            <>
          {/* Two-column layout */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          
          {/* Left: Invoice card */}
          <div className="lg:col-span-2">
            <div className="bg-white p-6 rounded-xl border border-gray-200 h-full">
              <h2 className="text-navy font-semibold text-lg mb-4">
                {student.currentTermName || 'Current Term'} Invoice
              </h2>

              {!student.currentInvoice ? (
                <div className="py-8 text-center">
                  <p className="text-gray-500 text-sm mb-3">No invoice generated for this term yet.</p>
                  <button 
                    disabled
                    className="px-4 py-2 bg-mint text-navy text-sm font-semibold rounded-lg opacity-50 cursor-not-allowed"
                  >
                    Generate invoice
                  </button>
                </div>
              ) : (
                <>
                  <table className="w-full mb-4">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="text-left text-xs text-gray-500 font-medium uppercase pb-2">Item</th>
                        <th className="text-right text-xs text-gray-500 font-medium uppercase pb-2">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="text-sm">
                      {(student.currentInvoice.lineItems as Array<{name: string, amount: number}>).map((item, idx) => (
                        <tr key={idx} className="border-b border-gray-50">
                          <td className="py-2 text-navy">{item.name}</td>
                          <td className="py-2 text-right text-navy">{formatNaira(Number(item.amount))}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="text-sm">
                      <tr>
                        <td className="pt-3 text-navy">Subtotal</td>
                        <td className="pt-3 text-right text-navy">{formatNaira(student.currentInvoice.subtotal)}</td>
                      </tr>
                      {student.currentInvoice.discountAmount > 0 && (
                        <tr>
                          <td className="py-1 text-gray-600">
                            Discount
                            {student.currentInvoice.discountReason && (
                              <span className="block text-xs text-gray-400 font-normal">{student.currentInvoice.discountReason}</span>
                            )}
                          </td>
                          <td className="py-1 text-right text-navy align-top">-{formatNaira(student.currentInvoice.discountAmount)}</td>
                        </tr>
                      )}
                      <tr>
                        <td className="pt-3 text-navy font-semibold">Total</td>
                        <td className="pt-3 text-right text-navy font-bold">{formatNaira(student.currentInvoice.totalAmount)}</td>
                      </tr>
                    </tfoot>
                  </table>

                  <div className="pt-4 border-t border-gray-100">
                    <div className="flex items-end justify-between mb-3">
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Paid</p>
                        <p className={`text-2xl font-bold ${student.currentInvoice.status === 'paid' ? 'text-mint' : 'text-navy'}`}>
                          {formatNaira(student.currentInvoice.paidAmount)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Outstanding</p>
                        <p className={`text-2xl font-bold ${outstanding > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
                          {formatNaira(outstanding)}
                        </p>
                      </div>
                      <div>
                        {student.currentInvoice.status === 'paid' ? (
                          <span className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium bg-mint-light text-mint rounded-full">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                            Paid in Full
                          </span>
                        ) : student.currentInvoice.status === 'partial' ? (
                          <span className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium bg-amber-100 text-amber-700 rounded-full">
                            Partial Payment
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium bg-red-100 text-red-700 rounded-full">
                            Unpaid
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="w-full bg-gray-100 rounded-full h-2 mb-2">
                      <div 
                        className={`h-2 rounded-full ${student.currentInvoice.status === 'paid' ? 'bg-mint' : 'bg-amber-500'}`}
                        style={{ width: `${collectionPercentage}%` }}
                      />
                    </div>
                    <p className="text-xs text-gray-500">
                      {collectionPercentage}% paid
                      {student.currentInvoice.fullyPaidAt && ` · Fully paid on ${formatDate(student.currentInvoice.fullyPaidAt)}`}
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Right: Family card */}
          <div>
            <div className="bg-white p-6 rounded-xl border border-gray-200 h-full">
              <h2 className="text-navy font-semibold text-lg mb-4">Family</h2>
              
              <div>
                <p className="text-xs text-gray-500 mb-1">Primary parent</p>
                <p className="text-base font-semibold text-navy mb-3">{student.family.primaryParentName}</p>
                
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <svg className="w-4 h-4 text-mint flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                    </svg>
                    <span className="text-navy">{student.family.primaryParentPhone}</span>
                  </div>
                  {student.family.primaryParentEmail && (
                    <div className="flex items-center gap-2 text-sm">
                      <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                      <span className="text-navy break-all">{student.family.primaryParentEmail}</span>
                    </div>
                  )}
                </div>

                {student.family.secondaryParentName && (
                  <div className="mt-4 pt-4 border-t border-gray-100">
                    <p className="text-xs text-gray-500 mb-1">Secondary parent</p>
                    <p className="text-base font-semibold text-navy mb-2">{student.family.secondaryParentName}</p>
                    {student.family.secondaryParentPhone && (
                      <p className="text-sm text-gray-700">{student.family.secondaryParentPhone}</p>
                    )}
                    {student.family.secondaryParentEmail && (
                      <p className="text-sm text-gray-700 break-all">{student.family.secondaryParentEmail}</p>
                    )}
                  </div>
                )}
              </div>

                {student.siblings.length > 0 && (
                <div className="mt-6 pt-6 border-t border-gray-100">
                    <p className="text-xs text-gray-500 mb-2">Siblings at this school</p>
                    <div className="space-y-2">
                    {student.siblings.map(sibling => (
                        <Link 
                        key={sibling.id}
                        href={`/students/${sibling.id}`}
                        className="flex items-center justify-between p-3 border border-gray-100 rounded-lg hover:bg-gray-50 group"
                        >
                        <div className="flex items-center gap-2 text-sm flex-wrap">
                            <span className="font-medium text-navy">{sibling.firstName} {sibling.lastName}</span>
                            <span className="text-gray-400 font-bold">·</span>
                            <span className="text-gray-500">{sibling.className}</span>
                            <span className="text-gray-400 font-bold">·</span>
                            {sibling.invoiceStatus === 'paid' && (
                            <span className="inline-flex items-center gap-1 text-mint font-medium">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                                Paid
                            </span>
                            )}
                            {sibling.invoiceStatus === 'partial' && (
                            <span className="inline-flex items-center gap-1 text-amber-600 font-medium">
                                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M12 2 A10 10 0 0 0 12 22 V2 Z" />
                                </svg>
                                Partial
                            </span>
                            )}
                            {sibling.invoiceStatus === 'pending' && (
                            <span className="inline-flex items-center gap-1 text-red-600 font-medium">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                                Unpaid
                            </span>
                            )}
                            {sibling.invoiceStatus === 'no_invoice' && (
                            <span className="text-gray-400">No invoice</span>
                            )}
                        </div>
                        <svg className="w-4 h-4 text-gray-400 group-hover:text-navy flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                        </Link>
                    ))}
                    </div>
                </div>
                )}

              <div className="mt-6 pt-6 border-t border-gray-100">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-gray-500">Notes</p>
                  <button className="text-xs text-mint font-medium hover:underline flex items-center gap-1">
                    Edit notes
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                </div>
                {student.family.notes ? (
                  <p className="text-sm text-gray-700">{student.family.notes}</p>
                ) : (
                  <p className="text-sm text-gray-400 italic">No notes yet</p>
                )}
              </div>
            </div>
          </div>

        </div>

        {/* Full-width activity timeline */}
                <StudentActivityTimeline 
                  studentId={student.id}
                  studentName={`${student.firstName} ${student.lastName}`}
                  parentName={student.family.primaryParentName}
                />
          </>
        )}

        {activeTab === 'settings' && (
          <StudentSettingsTab student={student} />
        )}

        {activeTab === 'payments' && paymentHistory && (
          <StudentPaymentHistoryTab data={paymentHistory} />
        )}
        {activeTab === 'fees' && feesData && (
          <StudentFeesTab data={feesData} />
        )}

      </div>
    </main>
  )
}