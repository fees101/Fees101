'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import type { StudentSortDir, StudentSortKey } from '@/lib/queries/students'

interface Student {
  id: string
  firstName: string
  lastName: string
  admissionNumber: string
  status: string
  className: string
  classId: string
  parentName: string
  parentPhone: string
  invoiceTotal: number
  invoicePaid: number
  creditApplied: number
  invoiceStatus: string
  outstandingBalance: number
}

interface Class {
  id: string
  name: string
}

interface StudentsTableProps {
  students: Student[]
  classes: Class[]
  total: number
  page: number
  perPage: number
  search: string
  classId: string
  invoiceStatus: string
  sortKey: StudentSortKey
  sortDir: StudentSortDir
}

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200]

function formatNaira(amount: number): string {
  return '₦' + amount.toLocaleString('en-NG')
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'paid':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-mint-light text-mint rounded-full">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          Paid
        </span>
      )
    case 'partial':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 rounded-full">
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2 A10 10 0 0 0 12 22 V2 Z" />
          </svg>
          Partial
        </span>
      )
    case 'pending':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700 rounded-full">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
          Unpaid
        </span>
      )
    default:
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600 rounded-full">
          No invoice
        </span>
      )
  }
}

function SortIcon({ active, direction }: { active: boolean, direction: StudentSortDir }) {
  return (
    <svg
      className={`w-3 h-3 inline-block ml-1 ${active ? 'text-navy' : 'text-gray-400'}`}
      fill="currentColor"
      viewBox="0 0 20 20"
    >
      {active && direction === 'asc' ? (
        <path d="M5 12l5-5 5 5H5z" />
      ) : active && direction === 'desc' ? (
        <path d="M5 8l5 5 5-5H5z" />
      ) : (
        <path d="M5 8l5-5 5 5H5zm0 4l5 5 5-5H5z" />
      )}
    </svg>
  )
}

function getPageNumbers(currentPage: number, totalPages: number): (number | '...')[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
  if (currentPage <= 3) return [1, 2, 3, 4, '...', totalPages]
  if (currentPage >= totalPages - 2) {
    return [1, '...', totalPages - 3, totalPages - 2, totalPages - 1, totalPages]
  }
  return [1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages]
}

// Search, class, invoice-status, sort and page are all server-driven (via the
// URL) rather than filtered/sorted client-side — the roster this fetches from
// can run into the hundreds, and computing every column client-side would mean
// downloading and re-sorting the whole thing on every keystroke. Only the
// current page's worth of students (and their invoice figures) ever gets
// fetched, matching the pattern already used on the audit log page.
export default function StudentsTable({
  students,
  classes,
  total,
  page,
  perPage,
  search,
  classId,
  invoiceStatus,
  sortKey,
  sortDir,
}: StudentsTableProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [searchInput, setSearchInput] = useState(search)

  function navigate(patch: Record<string, string>) {
    const params = new URLSearchParams({
      page: String(page),
      perPage: String(perPage),
      search,
      class: classId,
      invoiceStatus,
      sort: sortKey,
      dir: sortDir,
      ...patch,
    })
    for (const key of Array.from(params.keys())) {
      if (!params.get(key) || params.get(key) === 'all') params.delete(key)
    }
    router.push(params.toString() ? `${pathname}?${params.toString()}` : pathname)
  }

  // Debounce the search box so typing doesn't fire a navigation (and a fresh
  // server fetch) on every keystroke — only once the user pauses.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput !== search) navigate({ search: searchInput, page: '1' })
    }, 400)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput])

  useEffect(() => {
    setSearchInput(search)
  }, [search])

  function handleSort(key: StudentSortKey) {
    if (sortKey === key) {
      navigate({ sort: key, dir: sortDir === 'asc' ? 'desc' : 'asc', page: '1' })
    } else {
      navigate({ sort: key, dir: 'asc', page: '1' })
    }
  }

  // Class group-header rows are shown when sorting by class with no class
  // filter — purely visual. The count next to each header is only the
  // students in that class ON THIS PAGE, not the class's full roster — the
  // full filtered set no longer lives in the browser, so a page-spanning
  // class simply repeats its header (with a smaller count) at the top of
  // the next page.
  const groupByClass = sortKey === 'class' && classId === 'all'

  const totalPages = Math.max(1, Math.ceil(total / perPage))
  const rangeStart = total === 0 ? 0 : (page - 1) * perPage + 1
  const rangeEnd = Math.min(page * perPage, total)

  const classCountsOnPage: Record<string, number> = {}
  students.forEach((s) => {
    classCountsOnPage[s.classId] = (classCountsOnPage[s.classId] || 0) + 1
  })

  const selectClass = 'px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-mint focus:ring-2 focus:ring-mint/20'

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      {/* Filters bar */}
      <div className="p-4 border-b border-gray-200 flex flex-col sm:flex-row gap-3">
        <div className="flex-1 relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search by name, admission no., or parent..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-mint focus:ring-2 focus:ring-mint/20"
          />
        </div>
        <select
          value={classId}
          onChange={(e) => navigate({ class: e.target.value, page: '1' })}
          className={selectClass}
        >
          <option value="all">All classes</option>
          {classes.map(cls => (
            <option key={cls.id} value={cls.id}>{cls.name}</option>
          ))}
        </select>
        <select
          value={invoiceStatus}
          onChange={(e) => navigate({ invoiceStatus: e.target.value, page: '1' })}
          className={selectClass}
        >
          <option value="all">All statuses</option>
          <option value="paid">Paid</option>
          <option value="partial">Partial</option>
          <option value="pending">Unpaid</option>
          <option value="no_invoice">No invoice</option>
        </select>
      </div>

      {/* Table */}
      {total === 0 ? (
        <p className="text-gray-500 text-sm text-center py-12">
          No students match your filters.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th
                    onClick={() => handleSort('class')}
                    className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3 cursor-pointer hover:bg-gray-100 select-none"
                  >
                    Class <SortIcon active={sortKey === 'class'} direction={sortDir} />
                  </th>
                  <th
                    onClick={() => handleSort('name')}
                    className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3 cursor-pointer hover:bg-gray-100 select-none"
                  >
                    Student <SortIcon active={sortKey === 'name'} direction={sortDir} />
                  </th>
                  <th
                    onClick={() => handleSort('parent')}
                    className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3 cursor-pointer hover:bg-gray-100 select-none"
                  >
                    Parent <SortIcon active={sortKey === 'parent'} direction={sortDir} />
                  </th>
                  <th
                    onClick={() => handleSort('phone')}
                    className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3 cursor-pointer hover:bg-gray-100 select-none"
                  >
                    Phone <SortIcon active={sortKey === 'phone'} direction={sortDir} />
                  </th>
                  <th
                    onClick={() => handleSort('total')}
                    className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3 cursor-pointer hover:bg-gray-100 select-none"
                  >
                    Total expected <SortIcon active={sortKey === 'total'} direction={sortDir} />
                  </th>
                  <th
                    onClick={() => handleSort('paid')}
                    className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3 cursor-pointer hover:bg-gray-100 select-none"
                  >
                    Paid <SortIcon active={sortKey === 'paid'} direction={sortDir} />
                  </th>
                  <th
                    onClick={() => handleSort('status')}
                    className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3 cursor-pointer hover:bg-gray-100 select-none"
                  >
                    Status <SortIcon active={sortKey === 'status'} direction={sortDir} />
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(() => {
                  let lastClassId: string | null = null

                  return students.flatMap(student => {
                    const rows = []
                    if (groupByClass && student.classId !== lastClassId) {
                      lastClassId = student.classId
                      rows.push(
                        <tr key={`group-${student.classId}`} className="bg-gray-50/70">
                          <td colSpan={7} className="px-4 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                            {student.className || 'No class'} <span className="text-gray-400 font-normal normal-case">({classCountsOnPage[student.classId] || 0} on this page)</span>
                          </td>
                        </tr>
                      )
                    }
                    rows.push(
                      <tr
                        key={student.id}
                        onClick={() => router.push(`/students/${student.id}`)}
                        className="hover:bg-gray-50 cursor-pointer"
                      >
                        <td className="px-4 py-3 text-sm text-gray-700">{student.className}</td>
                        <td className="px-4 py-3">
                          <div>
                            <p className="text-sm font-medium text-navy">
                              {student.firstName} {student.lastName}
                            </p>
                            <p className="text-xs text-gray-500">{student.admissionNumber}</p>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">{student.parentName}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{student.parentPhone}</td>
                    <td className="px-4 py-3 text-sm text-navy font-medium">
                      {student.invoiceStatus !== 'no_invoice' ? (
                        <div>
                          <p>{formatNaira(student.invoiceTotal)}</p>
                          {student.creditApplied > 0 && (
                            <p className="text-xs text-mint font-normal">
                              {formatNaira(student.creditApplied)} credit applied
                            </p>
                          )}
                        </div>
                      ) : student.outstandingBalance > 0 ? (
                        <div>
                          <p className="text-red-600">{formatNaira(student.outstandingBalance)}</p>
                          <p className="text-xs text-gray-400 font-normal">owed from a past term</p>
                        </div>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {student.invoiceStatus !== 'no_invoice' ? (
                        <span className={
                          student.invoiceStatus === 'paid' ? 'text-mint font-medium' :
                          student.invoiceStatus === 'partial' ? 'text-amber-600 font-medium' :
                          'text-red-600 font-medium'
                        }>
                          {formatNaira(student.invoicePaid)}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {getStatusBadge(student.invoiceStatus)}
                    </td>
                      </tr>
                    )
                    return rows
                  })
                })()}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="px-4 py-3 border-t border-gray-200 flex flex-col sm:flex-row items-center gap-3 justify-between text-sm">
            <div className="flex items-center gap-4">
              <p className="text-gray-500">
                Showing {rangeStart}-{rangeEnd} of {total} students
              </p>
              <label className="flex items-center gap-1.5 text-gray-500">
                <span className="hidden sm:inline">Per page</span>
                <select
                  value={perPage}
                  onChange={(e) => navigate({ perPage: e.target.value, page: '1' })}
                  className="px-2 py-1 border border-gray-200 rounded-lg text-sm outline-none focus:border-mint focus:ring-2 focus:ring-mint/20"
                >
                  {PAGE_SIZE_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            </div>
            {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => navigate({ page: String(page - 1) })}
                disabled={page <= 1}
                className="px-3 py-1 text-sm text-gray-700 rounded hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ← Previous
              </button>
              {getPageNumbers(page, totalPages).map((p, index) => (
                p === '...' ? (
                  <span key={`ellipsis-${index}`} className="px-2 text-gray-400">...</span>
                ) : (
                  <button
                    key={p}
                    onClick={() => navigate({ page: String(p) })}
                    className={`min-w-[32px] px-2 py-1 text-sm rounded ${
                      page === p
                        ? 'bg-navy text-white font-medium'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {p}
                  </button>
                )
              ))}
              <button
                onClick={() => navigate({ page: String(page + 1) })}
                disabled={page >= totalPages}
                className="px-3 py-1 text-sm text-gray-700 rounded hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next →
              </button>
            </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
