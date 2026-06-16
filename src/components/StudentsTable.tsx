'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'

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
  invoiceStatus: string
}

interface Class {
  id: string
  name: string
}

interface StudentsTableProps {
  students: Student[]
  classes: Class[]
}

type SortKey = 'name' | 'parent' | 'phone' | 'total' | 'paid' | 'status'
type SortDir = 'asc' | 'desc'

const ITEMS_PER_PAGE = 25

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

function SortIcon({ active, direction }: { active: boolean, direction: SortDir }) {
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

export default function StudentsTable({ students, classes }: StudentsTableProps) {
  const router = useRouter()
  const [searchTerm, setSearchTerm] = useState('')
  const [classFilter, setClassFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [currentPage, setCurrentPage] = useState(1)

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
    setCurrentPage(1)
  }

  const filteredAndSorted = useMemo(() => {
    const filtered = students.filter(student => {
      const matchesSearch = 
        searchTerm === '' ||
        `${student.firstName} ${student.lastName}`.toLowerCase().includes(searchTerm.toLowerCase()) ||
        student.admissionNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
        student.parentName.toLowerCase().includes(searchTerm.toLowerCase())
      
      const matchesClass = classFilter === 'all' || student.classId === classFilter
      const matchesStatus = statusFilter === 'all' || student.invoiceStatus === statusFilter

      return matchesSearch && matchesClass && matchesStatus
    })

    return filtered.sort((a, b) => {
      let valA: string | number
      let valB: string | number

      switch (sortKey) {
        case 'name':
          valA = `${a.lastName} ${a.firstName}`.toLowerCase()
          valB = `${b.lastName} ${b.firstName}`.toLowerCase()
          break
        case 'parent':
          valA = a.parentName.toLowerCase()
          valB = b.parentName.toLowerCase()
          break
        case 'phone':
          valA = a.parentPhone
          valB = b.parentPhone
          break
        case 'total':
          valA = a.invoiceTotal
          valB = b.invoiceTotal
          break
        case 'paid':
          valA = a.invoicePaid
          valB = b.invoicePaid
          break
        case 'status':
          valA = a.invoiceStatus
          valB = b.invoiceStatus
          break
      }

      if (valA < valB) return sortDir === 'asc' ? -1 : 1
      if (valA > valB) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  }, [students, searchTerm, classFilter, statusFilter, sortKey, sortDir])

  const totalPages = Math.ceil(filteredAndSorted.length / ITEMS_PER_PAGE)
  const paginatedStudents = filteredAndSorted.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  )

  useMemo(() => {
    setCurrentPage(1)
  }, [searchTerm, classFilter, statusFilter])

  function getPageNumbers(): (number | string)[] {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1)
    }
    
    if (currentPage <= 3) {
      return [1, 2, 3, 4, '...', totalPages]
    }
    
    if (currentPage >= totalPages - 2) {
      return [1, '...', totalPages - 3, totalPages - 2, totalPages - 1, totalPages]
    }
    
    return [1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages]
  }

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
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-mint focus:ring-2 focus:ring-mint/20"
          />
        </div>
        <select
          value={classFilter}
          onChange={(e) => setClassFilter(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-mint focus:ring-2 focus:ring-mint/20"
        >
          <option value="all">All classes</option>
          {classes.map(cls => (
            <option key={cls.id} value={cls.id}>{cls.name}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-mint focus:ring-2 focus:ring-mint/20"
        >
          <option value="all">All statuses</option>
          <option value="paid">Paid</option>
          <option value="partial">Partial</option>
          <option value="pending">Unpaid</option>
          <option value="no_invoice">No invoice</option>
        </select>
      </div>

      {/* Table */}
      {filteredAndSorted.length === 0 ? (
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
                {paginatedStudents.map(student => (
                  <tr 
                    key={student.id} 
                    onClick={() => router.push(`/students/${student.id}`)}
                    className="hover:bg-gray-50 cursor-pointer"
                  >
                    <td className="px-4 py-3">
                      <div>
                        <p className="text-sm font-medium text-navy">
                          {student.firstName} {student.lastName}
                        </p>
                        <p className="text-xs text-gray-500">{student.className} · {student.admissionNumber}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">{student.parentName}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{student.parentPhone}</td>
                    <td className="px-4 py-3 text-sm text-navy font-medium">
                      {student.invoiceTotal > 0 ? formatNaira(student.invoiceTotal) : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {student.invoiceTotal > 0 ? (
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
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between text-sm">
            <p className="text-gray-500">
              Showing {(currentPage - 1) * ITEMS_PER_PAGE + 1}-{Math.min(currentPage * ITEMS_PER_PAGE, filteredAndSorted.length)} of {filteredAndSorted.length} students
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1 text-sm text-gray-700 rounded hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ← Previous
              </button>
              {getPageNumbers().map((page, index) => (
                page === '...' ? (
                  <span key={`ellipsis-${index}`} className="px-2 text-gray-400">...</span>
                ) : (
                  <button
                    key={page}
                    onClick={() => setCurrentPage(page as number)}
                    className={`min-w-[32px] px-2 py-1 text-sm rounded ${
                      currentPage === page
                        ? 'bg-navy text-white font-medium'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {page}
                  </button>
                )
              ))}
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-1 text-sm text-gray-700 rounded hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next →
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}