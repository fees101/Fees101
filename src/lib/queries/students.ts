import { getAuthContext } from '@/lib/auth/permissions'
import { computeInvoiceForStudent } from '@/lib/computeInvoice'
import { getRecurringDiscounts } from '@/lib/discounts/compute'

export const STUDENTS_PAGE_SIZE_OPTIONS = [25, 50, 100, 200]

export type StudentSortKey = 'class' | 'name' | 'parent' | 'phone' | 'total' | 'paid' | 'status'
export type StudentSortDir = 'asc' | 'desc'
export type StudentInvoiceStatusFilter = 'all' | 'paid' | 'partial' | 'pending' | 'no_invoice'

const INVOICE_DERIVED_SORT_KEYS = new Set<StudentSortKey>(['total', 'paid', 'status'])

// 'name' is the only sort key backed by a real, top-level column on
// `students` (last_name/first_name). Every other key lives on a joined
// table (classes.display_order, families.primary_parent_name/phone) or is
// computed from a per-cycle invoice lookup — and Postgrest's `.order(col,
// { foreignTable })` does not reorder the parent query's rows (verified
// live against this project's Supabase instance: it only reorders items
// within an embedded array, a no-op for a to-one join). So anything other
// than 'name' has to be sorted in JS over a lightweight first-pass fetch.
const JS_SORT_KEYS = new Set<StudentSortKey>(['class', 'parent', 'phone', 'total', 'paid', 'status'])

export interface GetStudentsOptions {
  statusFilter?: 'active' | 'withdrawn' | 'graduated' | 'all'
  search?: string
  classId?: string
  invoiceStatus?: StudentInvoiceStatusFilter
  sortKey?: StudentSortKey
  sortDir?: StudentSortDir
  page?: number
  perPage?: number
}

const STUDENT_ROW_SELECT = `
  id,
  first_name,
  last_name,
  admission_number,
  status,
  classes!inner(id, name, display_order),
  families!inner(primary_parent_name, primary_parent_phone)
`

// Postgrest's `or()`/`and()` filter grammar uses "," to separate conditions
// and "()" for grouping — strip those out of free-text search rather than
// trying to escape them, since a school admin typing a comma or parenthesis
// into the search box means it literally, not as a query operator.
function sanitizeSearchTerm(raw: string): string {
  return raw.trim().replace(/[,()]/g, '')
}

// A single `.or()` call can only filter columns on the table being queried —
// supabase-js's own docs say as much ("not currently possible to do an
// `.or()` filter across multiple tables"), which a live 400 against this
// project's Supabase confirmed when `families.primary_parent_name` was
// mixed into the same clause as `students` columns. Matching a family's
// parent name therefore has to happen as its own lookup first: resolve
// which families match, then fold their ids into the `students`-table `or()`
// via `family_id.in.(...)` — family_id is a real column on `students`, so
// that part stays within one table and is legal.
async function resolveSearchFamilyIds(supabase: any, schoolId: string, term: string): Promise<string[]> {
  const { data } = await supabase
    .from('families')
    .select('id')
    .eq('school_id', schoolId)
    .ilike('primary_parent_name', `%${term}%`)
  return (data || []).map((f: any) => f.id as string)
}

function studentSearchOrClause(term: string, familyIds: string[]): string {
  const t = `%${term}%`
  const parts = [`first_name.ilike.${t}`, `last_name.ilike.${t}`, `admission_number.ilike.${t}`]
  if (familyIds.length) parts.push(`family_id.in.(${familyIds.join(',')})`)
  return parts.join(',')
}

// Only ever used for the 'name' key — see JS_SORT_KEYS above for why every
// other sort key can't go through the database this way.
function applyNameSort(query: any, sortDir: StudentSortDir) {
  const ascending = sortDir === 'asc'
  return query.order('last_name', { ascending }).order('first_name', { ascending })
}

function mapStudentRow(student: any) {
  return {
    id: student.id,
    firstName: student.first_name,
    lastName: student.last_name,
    admissionNumber: student.admission_number,
    status: student.status,
    className: student.classes?.name || '',
    classId: student.classes?.id || '',
    parentName: student.families?.primary_parent_name || '',
    parentPhone: student.families?.primary_parent_phone || '',
  }
}

export interface StudentListRow extends ReturnType<typeof mapStudentRow> {
  invoiceTotal: number
  invoicePaid: number
  creditApplied: number
  invoiceStatus: string
  outstandingBalance: number
}

// Students page: server-side paginated, filtered and sorted so a roster of
// any size loads at the same speed — only the current page's worth of rows
// (and their invoice lookups) are ever fetched, instead of the whole school.
//
// Sorting by name maps to real, indexed columns on `students`, so that case
// goes through a single query with .order()+.range(). Every other sort key,
// and any invoice-status filter, needs a lightweight first pass first: a
// narrow projection (id, name, class, family, and — only when actually
// needed — the current cycle's invoice fields) across the WHOLE filtered
// set, so the sort order and the filtered count can be worked out in JS
// before fetching full display data for just the one page being rendered.
export async function getStudents(options: GetStudentsOptions = {}) {
  const ctx = await getAuthContext()
  if (!ctx) throw new Error('Not authenticated')
  const { supabase, schoolId } = ctx

  const statusFilter = options.statusFilter ?? 'active'
  const search = sanitizeSearchTerm(options.search || '')
  const classId = options.classId && options.classId !== 'all' ? options.classId : null
  const invoiceStatusFilter = options.invoiceStatus && options.invoiceStatus !== 'all' ? options.invoiceStatus : null
  const sortKey = options.sortKey ?? 'class'
  const sortDir = options.sortDir ?? 'asc'
  const page = Math.max(1, options.page ?? 1)
  const perPage = STUDENTS_PAGE_SIZE_OPTIONS.includes(options.perPage as number) ? (options.perPage as number) : 50

  const emptyResult = {
    students: [] as StudentListRow[],
    classes: [] as { id: string; name: string }[],
    currentTermName: '',
    classCount: 0,
    statusCounts: { active: 0, withdrawn: 0, graduated: 0, all: 0 },
    paymentsConfigured: false,
    studentsWithoutDvaCount: 0,
    total: 0,
    page,
    perPage,
  }

  if (!schoolId) return emptyResult

  // These five are independent of one another and of the filters above —
  // fetch in parallel. Status counts always reflect every status (not the
  // active filter/search/class/invoice filters) so the tab counts in the
  // header never shift under a search.
  const [
    { data: currentCycle },
    { data: classes },
    { data: allStudentsForCount },
    { data: schoolRow },
    { count: studentsWithoutDvaCount },
  ] = await Promise.all([
    supabase
      .from('billing_cycles')
      .select('id, name')
      .eq('school_id', schoolId)
      .eq('status', 'active')
      .order('start_date', { ascending: false })
      .limit(1)
      .single(),
    supabase
      .from('classes')
      .select('id, name')
      .eq('school_id', schoolId)
      .eq('is_active', true)
      .order('display_order'),
    supabase
      .from('students')
      .select('status')
      .eq('school_id', schoolId),
    supabase
      .from('schools')
      .select('payment_provider')
      .eq('id', schoolId)
      .single(),
    supabase
      .from('students')
      .select('id', { count: 'exact', head: true })
      .eq('school_id', schoolId)
      .eq('status', 'active')
      .is('provider_dva_reference', null),
  ])

  const statusCounts = {
    active: allStudentsForCount?.filter((s: any) => s.status === 'active').length || 0,
    withdrawn: allStudentsForCount?.filter((s: any) => s.status === 'withdrawn').length || 0,
    graduated: allStudentsForCount?.filter((s: any) => s.status === 'graduated').length || 0,
    all: allStudentsForCount?.length || 0,
  }
  const paymentsConfigured = !!schoolRow?.payment_provider
  const currentTermName = currentCycle?.name || ''
  const classCount = classes?.length || 0
  const tail = { classes: classes || [], currentTermName, classCount, statusCounts, paymentsConfigured, studentsWithoutDvaCount: studentsWithoutDvaCount || 0 }

  // Class display order comes from this list, which is already sorted by
  // the real `display_order` column at the top level (a plain, unjoined
  // query) — its array position is a safe stand-in for that rank.
  const classOrder: Record<string, number> = {}
  ;(classes || []).forEach((c: any, i: number) => { classOrder[c.id] = i })

  const needsInvoiceData = !!invoiceStatusFilter || INVOICE_DERIVED_SORT_KEYS.has(sortKey)
  const needsFirstPass = JS_SORT_KEYS.has(sortKey) || !!invoiceStatusFilter

  const searchFamilyIds = search ? await resolveSearchFamilyIds(supabase, schoolId, search) : []

  let studentRows: any[] = []
  let total = 0

  if (needsFirstPass) {
    // Pass 1: a narrow projection for every student matching the
    // school/status/class/search filters — cheap enough to run over the
    // whole filtered set instead of just one page.
    let q1 = supabase
      .from('students')
      .select(
        `id, last_name, first_name, class_id, families!inner(primary_parent_name, primary_parent_phone)` +
        (needsInvoiceData ? ', invoices!left(total_amount, paid_amount, status)' : '')
      )
      .eq('school_id', schoolId)
    if (needsInvoiceData) q1 = q1.eq('invoices.billing_cycle_id', currentCycle?.id || '')
    if (statusFilter !== 'all') q1 = q1.eq('status', statusFilter)
    if (classId) q1 = q1.eq('class_id', classId)
    if (search) q1 = q1.or(studentSearchOrClause(search, searchFamilyIds))
    const { data: rows1 } = await q1

    let derived = (rows1 || []).map((r: any) => {
      const inv = r.invoices?.[0]
      return {
        id: r.id as string,
        lastName: (r.last_name || '') as string,
        firstName: (r.first_name || '') as string,
        classId: (r.class_id || '') as string,
        parentName: (r.families?.primary_parent_name || '') as string,
        parentPhone: (r.families?.primary_parent_phone || '') as string,
        total: inv ? Number(inv.total_amount) : 0,
        paid: inv ? Number(inv.paid_amount) : 0,
        status: (inv?.status as string) || 'no_invoice',
      }
    })
    if (invoiceStatusFilter) derived = derived.filter((d: any) => d.status === invoiceStatusFilter)
    total = derived.length

    if (JS_SORT_KEYS.has(sortKey)) {
      derived.sort((a: any, b: any) => {
        let va: string | number
        let vb: string | number
        if (sortKey === 'class') {
          const orderA = classOrder[a.classId] ?? 9999
          const orderB = classOrder[b.classId] ?? 9999
          if (orderA !== orderB) return sortDir === 'asc' ? orderA - orderB : orderB - orderA
          va = `${a.lastName} ${a.firstName}`.toLowerCase()
          vb = `${b.lastName} ${b.firstName}`.toLowerCase()
        } else if (sortKey === 'parent') {
          va = a.parentName.toLowerCase()
          vb = b.parentName.toLowerCase()
        } else if (sortKey === 'phone') {
          va = a.parentPhone
          vb = b.parentPhone
        } else {
          va = a[sortKey as 'total' | 'paid' | 'status']
          vb = b[sortKey as 'total' | 'paid' | 'status']
        }
        if (va < vb) return sortDir === 'asc' ? -1 : 1
        if (va > vb) return sortDir === 'asc' ? 1 : -1
        return 0
      })
      const pageIds = derived.slice((page - 1) * perPage, page * perPage).map((d: any) => d.id)
      if (pageIds.length) {
        const { data: fullRows } = await supabase.from('students').select(STUDENT_ROW_SELECT).in('id', pageIds)
        const byId = new Map((fullRows || []).map((r: any) => [r.id, r]))
        studentRows = pageIds.map((id: string) => byId.get(id)).filter(Boolean)
      }
    } else {
      // sortKey === 'name' with an invoice-status filter narrowing the id
      // set — last_name/first_name are real columns, so the DB can order
      // and paginate the already-filtered ids directly.
      const matchingIds = derived.map((d: any) => d.id)
      if (matchingIds.length) {
        let q2 = supabase.from('students').select(STUDENT_ROW_SELECT).in('id', matchingIds)
        q2 = applyNameSort(q2, sortDir)
        q2 = q2.range((page - 1) * perPage, page * perPage - 1)
        const { data } = await q2
        studentRows = data || []
      }
    }
  } else {
    // sortKey === 'name', no invoice filter — a single query does
    // filtering, ordering and pagination together.
    let q = supabase.from('students').select(STUDENT_ROW_SELECT, { count: 'exact' }).eq('school_id', schoolId)
    if (statusFilter !== 'all') q = q.eq('status', statusFilter)
    if (classId) q = q.eq('class_id', classId)
    if (search) q = q.or(studentSearchOrClause(search, searchFamilyIds))
    q = applyNameSort(q, sortDir)
    q = q.range((page - 1) * perPage, page * perPage - 1)
    const { data, count } = await q
    studentRows = data || []
    total = count || 0
  }

  if (studentRows.length === 0) return { ...emptyResult, ...tail, total }

  // Invoice + outstanding-balance lookups, bounded to just this page's
  // students (at most `perPage` ids) instead of the whole roster.
  const studentIds = studentRows.map((s: any) => s.id)
  const [{ data: invoices }, { data: allOutstandingInvoices }] = await Promise.all([
    supabase
      .from('invoices')
      .select('student_id, total_amount, paid_amount, credit_applied, status')
      .in('student_id', studentIds)
      .eq('billing_cycle_id', currentCycle?.id || ''),
    // Total owed across every non-cancelled, non-superseded invoice — not just
    // the current term's. This is what makes a former student's debt visible:
    // a withdrawn/graduated student has no current-cycle invoice at all, so
    // invoiceTotal/invoiceStatus above would otherwise read as "no_invoice"
    // even while they still owe money from their last term.
    supabase
      .from('invoices')
      .select('student_id, outstanding_amount, previous_balance_from_invoice_id, id')
      .in('student_id', studentIds)
      .neq('status', 'cancelled'),
  ])

  const supersededIds = new Set(
    (allOutstandingInvoices || [])
      .map((inv: any) => inv.previous_balance_from_invoice_id)
      .filter(Boolean)
  )

  const outstandingBalanceByStudent: Record<string, number> = {}
  ;(allOutstandingInvoices || []).forEach((inv: any) => {
    if (supersededIds.has(inv.id)) return
    const outstanding = Number(inv.outstanding_amount || 0)
    if (outstanding <= 0) return
    outstandingBalanceByStudent[inv.student_id] = (outstandingBalanceByStudent[inv.student_id] || 0) + outstanding
  })

  const studentsWithStatus = studentRows.map((student: any) => {
    const invoice = invoices?.find((inv: any) => inv.student_id === student.id)
    const base = mapStudentRow(student)
    return {
      ...base,
      // Net (post-credit) figures — matches the parent-facing invoice and the
      // school's own collection rule (a credit application isn't new money
      // collected this term, since it was already counted when the cash
      // first arrived). Showing the gross pre-credit total here would read
      // as "the school collected X" when X was never actually paid this
      // term, and would color "Paid" red (unpaid status) right next to a
      // large paid-looking number, which is exactly backwards. Credit is
      // surfaced separately via creditApplied instead of folded in here.
      invoiceTotal: invoice ? Number(invoice.total_amount) : 0,
      invoicePaid: invoice ? Number(invoice.paid_amount) : 0,
      creditApplied: invoice ? Number(invoice.credit_applied || 0) : 0,
      invoiceStatus: invoice?.status || 'no_invoice',
      // All-time outstanding balance (across every term, not just the
      // current one) — the figure that matters for a former student, since
      // they'll never have a current-cycle invoice again.
      outstandingBalance: outstandingBalanceByStudent[student.id] || 0,
    }
  })

  return {
    students: studentsWithStatus,
    ...tail,
    total,
    page,
    perPage,
  }
}

export async function getStudentById(studentId: string) {
  const ctx = await getAuthContext()
  if (!ctx) throw new Error('Not authenticated')
  const { supabase, schoolId } = ctx
  if (!schoolId) return null

  // Round 1: student, school payment config, and current cycle are all
  // independent of one another.
  const [{ data: student }, { data: schoolRow }, { data: currentCycle }] = await Promise.all([
    supabase
      .from('students')
      .select(`
        id,
        first_name,
        last_name,
        admission_number,
        admission_date,
        status,
        provider_dva_reference,
        provider_dva_account_number,
        provider_dva_bank_name,
        classes!inner(id, name),
        families!inner(
          id,
          primary_parent_name,
          primary_parent_phone,
          primary_parent_email,
          secondary_parent_name,
          secondary_parent_phone,
          secondary_parent_email,
          notes
        )
      `)
      .eq('id', studentId)
      .eq('school_id', schoolId)
      .single(),
    // Whether this school has a payment provider at all — drives the header's
    // virtual-account state (has account / can create / not configured).
    supabase
      .from('schools')
      .select('payment_provider')
      .eq('id', schoolId)
      .single(),
    // Get current billing cycle
    supabase
      .from('billing_cycles')
      .select('id, name')
      .eq('school_id', schoolId)
      .eq('status', 'active')
      .order('start_date', { ascending: false })
      .limit(1)
      .single(),
  ])

  if (!student) return null

  // Round 2: current-term invoice (needs the cycle) and siblings (needs the
  // family) — independent of each other.
  // @ts-expect-error — families is joined object
  const familyId = student.families?.id
  const SIBLINGS_LIMIT = 20
  const [{ data: currentInvoice }, { data: siblings }, { count: siblingsTotalCount }] = await Promise.all([
    // Get current term invoice
    supabase
      .from('invoices')
      .select('*')
      .eq('student_id', studentId)
      .eq('billing_cycle_id', currentCycle?.id || '')
      .maybeSingle(),
    // Get siblings (other students in same family) — capped so a very large
    // family can't render/query an unbounded list on this page.
    supabase
      .from('students')
      .select(`
        id,
        first_name,
        last_name,
        classes!inner(name)
      `)
      .eq('school_id', schoolId)
      .eq('family_id', familyId)
      .neq('id', studentId)
      .eq('status', 'active')
      .order('first_name')
      .limit(SIBLINGS_LIMIT),
    supabase
      .from('students')
      .select('id', { count: 'exact', head: true })
      .eq('school_id', schoolId)
      .eq('family_id', familyId)
      .neq('id', studentId)
      .eq('status', 'active'),
  ])

  // Round 3: everything that depends on the invoice and/or siblings — the
  // revocable-discount rows, this term's payments, and sibling invoice
  // statuses — all fetched together.
  // Discounts the admin can revoke from this invoice via the "Edit discount"
  // button — recurring ones (scoped by student+category, since a carried-
  // forward discount's stored invoice_id may point at an earlier term) plus
  // one-off manual discounts requested directly against this exact invoice.
  // Sibling discounts are excluded — they're auto-computed every generation,
  // never a standalone approved row, so there's nothing to revoke.
  //
  // Two separate gates, since "sent" and "paid" mean different things here:
  // - canAddDiscount: blocked only once a payment has landed — a parent can
  //   still notice a missed discount and get it applied after the invoice
  //   was sent but before they've paid anything.
  // - canFullyRevokeDiscount: blocked once EITHER the invoice was sent OR
  //   paid against — once the parent has seen a total, changing it away
  //   (rather than just stopping it going forward) needs a firmer bar.
  const siblingIds = siblings?.map(s => s.id) || []
  const [recurring, oneOffResult, paymentResult, siblingInvoiceResult] = await Promise.all([
    currentInvoice ? getRecurringDiscounts(supabase, schoolId, studentId) : Promise.resolve([]),
    currentInvoice
      ? supabase
          .from('discounts')
          .select('id, category, reason')
          .eq('school_id', schoolId)
          .eq('invoice_id', currentInvoice.id)
          .eq('status', 'applied')
          .eq('is_recurring', false)
          .not('requested_by', 'is', null)
      : Promise.resolve({ data: null }),
    // Get payment history for current term invoice
    currentInvoice
      ? supabase
          .from('payments')
          .select('id, amount, method, paid_at, provider_reference')
          .eq('invoice_id', currentInvoice.id)
          .eq('match_status', 'matched')
          .order('paid_at', { ascending: false })
      : Promise.resolve({ data: null }),
    // Get sibling invoice statuses for current term
    siblings && currentCycle && siblingIds.length > 0
      ? supabase
          .from('invoices')
          .select('student_id, status')
          .in('student_id', siblingIds)
          .eq('billing_cycle_id', currentCycle.id)
      : Promise.resolve({ data: null }),
  ])

  let revocableDiscounts: { id: string; category: string; reason: string; isRecurring: boolean }[] = []
  let canAddDiscount = false
  let canFullyRevokeDiscount = false
  if (currentInvoice) {
    const oneOffRows = (oneOffResult as any).data
    revocableDiscounts = [
      ...recurring.map((row: any) => ({ id: row.id, category: row.category, reason: row.reason, isRecurring: true })),
      ...(oneOffRows || []).map((row: any) => ({ id: row.id, category: row.category, reason: row.reason, isRecurring: false })),
    ]
    canAddDiscount = Number(currentInvoice.paid_amount || 0) === 0
    canFullyRevokeDiscount = !currentInvoice.sent_at && Number(currentInvoice.paid_amount || 0) === 0
  }

  // The current-cycle invoice may have no discount of its own (or not exist
  // yet) while an earlier invoice does — e.g. a one-off discount applied last
  // term. Without this, that discount becomes permanently unreachable from
  // the UI. Only runs when the current invoice didn't already surface something.
  let fallbackDiscountInvoiceId: string | null = null
  if (revocableDiscounts.length === 0) {
    const { data: latest } = await supabase
      .from('discounts')
      .select('invoice_id, invoices!inner(id, sent_at, paid_amount, generated_at)')
      .eq('school_id', schoolId)
      .eq('student_id', studentId)
      .eq('status', 'applied')
      .eq('is_recurring', false)
      .not('requested_by', 'is', null)
      .order('generated_at', { ascending: false, foreignTable: 'invoices' })
      .limit(1)
      .maybeSingle()
    if (latest) {
      const { data: fallbackRows } = await supabase
        .from('discounts')
        .select('id, category, reason')
        .eq('school_id', schoolId)
        .eq('invoice_id', (latest as any).invoice_id)
        .eq('status', 'applied')
        .eq('is_recurring', false)
        .not('requested_by', 'is', null)
      const fallbackInvoice = (latest as any).invoices
      revocableDiscounts = (fallbackRows || []).map((row: any) => ({ id: row.id, category: row.category, reason: row.reason, isRecurring: false }))
      canFullyRevokeDiscount = !fallbackInvoice?.sent_at && Number(fallbackInvoice?.paid_amount || 0) === 0
      fallbackDiscountInvoiceId = (latest as any).invoice_id
    }
  }

  let siblingsWithStatus: Array<{
    id: string
    firstName: string
    lastName: string
    className: string
    invoiceStatus: string
  }> = []

  if (siblings && currentCycle) {
    const siblingInvoices = (siblingInvoiceResult as any).data
    siblingsWithStatus = siblings.map(sib => {
      const invoice = siblingInvoices?.find((inv: any) => inv.student_id === sib.id)
      return {
        id: sib.id,
        firstName: sib.first_name,
        lastName: sib.last_name,
        // @ts-expect-error — joined object
        className: sib.classes?.name || '',
        invoiceStatus: invoice?.status || 'no_invoice',
      }
    })
  }

  const payments: any[] = (paymentResult as any).data || []

  return {
    id: student.id,
    firstName: student.first_name,
    lastName: student.last_name,
    admissionNumber: student.admission_number,
    admissionDate: student.admission_date,
    status: student.status,
    // @ts-expect-error — joined object
    className: student.classes?.name || '',
    // @ts-expect-error — joined object
    classId: student.classes?.id || '',
    family: {
      // @ts-expect-error — joined object
      id: student.families?.id || '',
      // @ts-expect-error — joined object
      primaryParentName: student.families?.primary_parent_name || '',
      // @ts-expect-error — joined object
      primaryParentPhone: student.families?.primary_parent_phone || '',
      // @ts-expect-error — joined object
      primaryParentEmail: student.families?.primary_parent_email || '',
      // @ts-expect-error — joined object
      secondaryParentName: student.families?.secondary_parent_name || '',
      // @ts-expect-error — joined object
      secondaryParentPhone: student.families?.secondary_parent_phone || '',
      // @ts-expect-error — joined object
      secondaryParentEmail: student.families?.secondary_parent_email || '',
      // @ts-expect-error — joined object
      notes: student.families?.notes || '',
    },
    virtualAccount: {
      providerConfigured: !!schoolRow?.payment_provider,
      hasAccount: !!student.provider_dva_reference,
      accountNumber: student.provider_dva_account_number || null,
      bankName: student.provider_dva_bank_name || null,
    },
    siblings: siblingsWithStatus,
    siblingsTotalCount: siblingsTotalCount || 0,
    currentTermName: currentCycle?.name || '',
    currentCycleId: currentCycle?.id || null,
    currentInvoice: currentInvoice ? {
      id: currentInvoice.id,
      lineItems: currentInvoice.line_items || [],
      subtotal: Number(currentInvoice.subtotal || 0),
      discountAmount: Number(currentInvoice.discount_amount || 0),
      discountReason: currentInvoice.discount_reason || '',
      totalAmount: Number(currentInvoice.total_amount),
      paidAmount: Number(currentInvoice.paid_amount),
      status: currentInvoice.status,
      generatedAt: currentInvoice.generated_at,
      fullyPaidAt: currentInvoice.fully_paid_at,
      needsResend: currentInvoice.needs_resend,
      sentAt: currentInvoice.sent_at,
      revocableDiscounts,
      canAddDiscount,
      canFullyRevokeDiscount,
    } : null,
    // Same values as above when there's a current invoice (so they always
    // agree); populated on their own when there's no current invoice at all.
    fallbackDiscountInvoiceId,
    fallbackDiscounts: revocableDiscounts,
    fallbackCanFullyRevoke: canFullyRevokeDiscount,
    payments,
  }
}
export async function getStudentPaymentHistory(studentId: string) {
  const ctx = await getAuthContext()
  if (!ctx) throw new Error('Not authenticated')
  const { supabase, schoolId } = ctx
  if (!schoolId) return null

  // Verify student belongs to this school; credit_balance feeds the
  // "unapplied credit" note. The virtual account (DVA) now lives in the
  // student header, not this tab, so it's no longer fetched here.
  const { data: student } = await supabase
    .from('students')
    .select('id, credit_balance')
    .eq('id', studentId)
    .eq('school_id', schoolId)
    .single()

  if (!student) return null

  // Get all invoices and payments for this student — independent of each other.
  const [{ data: invoices }, { data: payments }] = await Promise.all([
    supabase
      .from('invoices')
      .select(`
        id,
        total_amount,
        paid_amount,
        status,
        generated_at,
        fully_paid_at,
        line_items,
        billing_cycle_id,
        billing_cycles!inner(id, name)
      `)
      .eq('student_id', studentId)
      .order('generated_at', { ascending: false }),
    supabase
      .from('payments')
      .select(`
        id,
        amount,
        method,
        paid_at,
        provider_reference,
        invoice_id
      `)
      .eq('student_id', studentId)
      .eq('match_status', 'matched')
      .order('paid_at', { ascending: false }),
  ])

  // Compute summary numbers
  const totalInvoiced = invoices?.reduce((sum, inv) => sum + Number(inv.total_amount), 0) || 0
  // Real cash received, not invoice-derived — a payment that arrived before
  // any invoice existed (or after every invoice was already settled) has no
  // invoice.paid_amount to be summed into, but the family really did send
  // it. Summing payments directly means this never reads as "₦0 paid" while
  // money is actually sitting on the student's credit_balance.
  const totalPaid = payments?.reduce((sum, p) => sum + Number(p.amount), 0) || 0
  // Outstanding stays invoice-scoped on purpose — it's "what's still owed
  // against what's been billed," independent of any unapplied credit.
  const outstanding = invoices?.reduce((sum, inv) => sum + Math.max(0, Number(inv.total_amount) - Number(inv.paid_amount)), 0) || 0
  const termsInvoiced = invoices?.length || 0
  const unappliedCredit = Number(student.credit_balance || 0)

  // Format invoices
  const formattedInvoices = invoices?.map(inv => ({
    id: inv.id,
    // @ts-expect-error — joined object
    termName: inv.billing_cycles?.name || '',
    totalAmount: Number(inv.total_amount),
    paidAmount: Number(inv.paid_amount),
    status: inv.status,
    generatedAt: inv.generated_at,
    fullyPaidAt: inv.fully_paid_at,
    lineItems: inv.line_items || [],
  })) || []

  // Format payments with which invoice (term) they applied to
  const invoiceLookup = new Map(
    invoices?.map(inv => [
      inv.id, 
      // @ts-expect-error — joined object
      inv.billing_cycles?.name || ''
    ]) || []
  )

  const formattedPayments = payments?.map(p => ({
    id: p.id,
    amount: Number(p.amount),
    method: p.method,
    paidAt: p.paid_at,
    reference: p.provider_reference || '',
    appliedTo: p.invoice_id ? invoiceLookup.get(p.invoice_id) || 'Unknown term' : 'Credit balance (not yet invoiced)',
  })) || []

  return {
    summary: {
      totalInvoiced,
      totalPaid,
      outstanding,
      termsInvoiced,
      unappliedCredit,
    },
    invoices: formattedInvoices,
    payments: formattedPayments,
  }
}
// ============ STUDENT FEES (for Fees tab) ============

export interface StudentFeeItem {
  id: string
  name: string
  amount: number
  isSchoolWide: boolean
  isRequired: boolean
  isOptional: boolean
  isExempted: boolean
  exemptionNotes?: string
  isOptedIn: boolean
  optInNotes?: string
}

export interface StudentFeesData {
  student: {
    id: string
    firstName: string
    lastName: string
    admissionNumber: string
    classId: string | null
    className: string
    status: string
  }
  cycle: {
    id: string
    name: string
    status: string
  } | null
  requiredFees: StudentFeeItem[]
  optionalFees: StudentFeeItem[]
  requiredTotal: number
  exemptionTotal: number
  optInTotal: number
  expectedCreditApplied: number
  expectedBill: number
  expectedDiscountAmount: number
  expectedDiscountReason: string
  // Opt-out overages left "as-is" for a manual refund outside the app — see
  // resolveDeferredOptOutOverage — pending someone marking them resolved.
  unresolvedCredits: { id: string; feeItemName: string; amount: number; createdAt: string }[]
  existingInvoice: {
    id: string
    totalAmount: number
    subtotal: number
    paidAmount: number
    outstandingAmount: number
    creditApplied: number
    discountAmount: number
    discountReason: string
    status: 'pending' | 'partial' | 'paid' | 'overdue' | 'cancelled'
    sentAt: string | null
    needsResend: boolean
    previousBalance: number
    generatedAt: string
  } | null
}

export async function getStudentFees(studentId: string): Promise<StudentFeesData | null> {
  const ctx = await getAuthContext()
  if (!ctx) throw new Error('Not authenticated')
  const { supabase, schoolId } = ctx
  if (!schoolId) return null

  // Get student with class
  const { data: studentData } = await supabase
    .from('students')
    .select(`
      id,
      first_name,
      last_name,
      admission_number,
      class_id,
      status,
      credit_balance,
      classes(id, name)
    `)
    .eq('id', studentId)
    .eq('school_id', schoolId)
    .single()

  if (!studentData) return null

  const { data: unresolvedCreditsData } = await supabase
    .from('unresolved_credits')
    .select('id, fee_item_name, amount, created_at')
    .eq('school_id', schoolId)
    .eq('student_id', studentId)
    .is('resolved_at', null)
    .order('created_at', { ascending: true })

  const unresolvedCredits = (unresolvedCreditsData || []).map(c => ({
    id: c.id,
    feeItemName: c.fee_item_name,
    amount: Number(c.amount),
    createdAt: c.created_at,
  }))

  const student = {
    id: studentData.id,
    firstName: studentData.first_name,
    lastName: studentData.last_name,
    admissionNumber: studentData.admission_number,
    classId: studentData.class_id,
    // @ts-expect-error — joined
    className: studentData.classes?.name || '',
    status: studentData.status,
  }

  // Get active billing cycle
  const { data: cycle } = await supabase
    .from('billing_cycles')
    .select('id, name, status, start_date')
    .eq('school_id', schoolId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle()

  if (!cycle) {
    return {
      student,
      cycle: null,
      requiredFees: [],
      optionalFees: [],
      requiredTotal: 0,
      exemptionTotal: 0,
      optInTotal: 0,
      expectedBill: 0,
      expectedCreditApplied: 0,
      expectedDiscountAmount: 0,
      expectedDiscountReason: '',
      unresolvedCredits,
      existingInvoice: null,
    }
  }

  // Get fee items that apply to this student
  let feeItemsQuery = supabase
    .from('fee_items')
    .select('id, class_id, name, amount, is_mandatory, is_optional_extra')
    .eq('school_id', schoolId)
    .eq('billing_cycle_id', cycle.id)

  if (student.classId) {
    feeItemsQuery = feeItemsQuery.or(`class_id.eq.${student.classId},class_id.is.null`)
  } else {
    feeItemsQuery = feeItemsQuery.is('class_id', null)
  }

  const { data: feeItems } = await feeItemsQuery

  // Get adjustments for this student
  const { data: adjustments } = await supabase
    .from('student_fee_adjustments')
    .select('fee_item_id, adjustment_type, notes')
    .eq('student_id', studentId)
    .eq('school_id', schoolId)

  const optInsByFeeItem = new Map<string, { notes?: string }>()
  const exemptionsByFeeItem = new Map<string, { notes?: string }>()
  adjustments?.forEach(adj => {
    if (adj.adjustment_type === 'opt_in') {
      optInsByFeeItem.set(adj.fee_item_id, { notes: adj.notes || undefined })
    } else if (adj.adjustment_type === 'exempt') {
      exemptionsByFeeItem.set(adj.fee_item_id, { notes: adj.notes || undefined })
    }
  })

  const requiredFees: StudentFeeItem[] = []
  const optionalFees: StudentFeeItem[] = []

  feeItems?.forEach(f => {
    const exemption = exemptionsByFeeItem.get(f.id)
    const optIn = optInsByFeeItem.get(f.id)
    const isSchoolWide = f.class_id === null

    const item: StudentFeeItem = {
      id: f.id,
      name: f.name,
      amount: Number(f.amount),
      isSchoolWide,
      isRequired: f.is_mandatory,
      isOptional: f.is_optional_extra,
      isExempted: !!exemption,
      exemptionNotes: exemption?.notes,
      isOptedIn: !!optIn,
      optInNotes: optIn?.notes,
    }

    if (f.is_mandatory) {
      requiredFees.push(item)
    } else {
      optionalFees.push(item)
    }
  })

  function sortFn(a: StudentFeeItem, b: StudentFeeItem) {
    if (a.isSchoolWide !== b.isSchoolWide) return a.isSchoolWide ? -1 : 1
    return a.name.localeCompare(b.name)
  }
  requiredFees.sort(sortFn)
  optionalFees.sort(sortFn)

  const requiredTotal = requiredFees.reduce((sum, f) => sum + f.amount, 0)
  const exemptionTotal = requiredFees
    .filter(f => f.isExempted)
    .reduce((sum, f) => sum + f.amount, 0)
  const optInTotal = optionalFees
    .filter(f => f.isOptedIn)
    .reduce((sum, f) => sum + f.amount, 0)

    
  // After you have cycle.id, before computing expectedBill

  // Look up carry-forward from most recent closed term
  let carryForwardAmount = 0
  const { data: priorClosedCycle } = await supabase
    .from('billing_cycles')
    .select('id, start_date')
    .eq('school_id', schoolId)
    .eq('status', 'closed')
    .lt('start_date', cycle.start_date)  // needs cycle.start_date available
    .order('start_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (priorClosedCycle) {
    const { data: priorInvoice } = await supabase
      .from('invoices')
      .select('total_amount, paid_amount')
      .eq('student_id', studentId)
      .eq('billing_cycle_id', priorClosedCycle.id)
      .maybeSingle()

    if (priorInvoice) {
      const outstanding = Number(priorInvoice.total_amount) - Number(priorInvoice.paid_amount || 0)
      if (outstanding > 0) carryForwardAmount = outstanding
    }
  }

  // Check if an invoice already exists for this student + cycle
  const { data: existingInvoice } = await supabase
    .from('invoices')
    .select('id, total_amount, subtotal, paid_amount, credit_applied, status, sent_at, needs_resend, previous_balance, line_items, generated_at, discount_amount, discount_reason')
    .eq('student_id', studentId)
    .eq('billing_cycle_id', cycle.id)
    .maybeSingle()

  // expectedBill must come from the same canonical computation used to
  // actually generate/regenerate invoices (computeInvoiceForStudent), not
  // a parallel hand-rolled formula — a second implementation is exactly
  // how this drifted out of sync with credit_applied in the first place.
  // Same restore-then-compare trick as the cycle-detail staleness check:
  // simulate this invoice's own credit being restored before recomputing,
  // so an already-correct invoice doesn't get flagged as stale forever.
  const effectiveCredit = Number(studentData.credit_balance || 0) + Number(existingInvoice?.credit_applied || 0)
  // Pass existingInvoice?.id so a manual one-off discount already on this
  // invoice is included in the recompute — otherwise the Fees tab would show
  // "adjustments have been made" perpetually for any discounted invoice.
  const computedBill = await computeInvoiceForStudent(supabase, schoolId, studentId, cycle.id, effectiveCredit, Number(existingInvoice?.paid_amount || 0), existingInvoice?.id)
  const expectedBill = !('error' in computedBill)
    ? computedBill.total
    : requiredTotal - exemptionTotal + optInTotal + carryForwardAmount
  // Needed alongside expectedBill for staleness comparison — a fee change
  // (e.g. a new opt-in) can leave the final total unchanged when credit
  // fully covers the bill either way, while credit_applied itself differs.
  // Comparing total alone would miss that the invoice is genuinely stale.
  const expectedCreditApplied = !('error' in computedBill) ? computedBill.creditApplied : 0
  const expectedDiscountAmount = !('error' in computedBill) ? computedBill.discountAmount : 0
  const expectedDiscountReason = !('error' in computedBill) ? computedBill.discountReason : ''

  const existingInvoiceInfo = existingInvoice ? {
    id: existingInvoice.id,
    totalAmount: Number(existingInvoice.total_amount),
    subtotal: Number(existingInvoice.subtotal || 0),
    paidAmount: Number(existingInvoice.paid_amount || 0),
    outstandingAmount: Number(existingInvoice.total_amount) - Number(existingInvoice.paid_amount || 0),
    creditApplied: Number(existingInvoice.credit_applied || 0),
    discountAmount: Number(existingInvoice.discount_amount || 0),
    discountReason: existingInvoice.discount_reason || '',
    status: existingInvoice.status as 'pending' | 'partial' | 'paid' | 'overdue' | 'cancelled',
    sentAt: existingInvoice.sent_at,
    needsResend: existingInvoice.needs_resend,
    previousBalance: Number(existingInvoice.previous_balance || 0),
    generatedAt: existingInvoice.generated_at,
  } : null

return {
    student,
    cycle: { id: cycle.id, name: cycle.name, status: cycle.status },
    requiredFees,
    optionalFees,
    requiredTotal,
    exemptionTotal,
    optInTotal,
    expectedBill,
    expectedCreditApplied,
    expectedDiscountAmount,
    expectedDiscountReason,
    unresolvedCredits,
    existingInvoice: existingInvoiceInfo,
  }
}