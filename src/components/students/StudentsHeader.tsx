'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import AddStudentModal from './AddStudentModal'
import Link from 'next/link'

interface Class {
  id: string
  name: string
}

interface StatusCounts {
  active: number
  withdrawn: number
  graduated: number
  all: number
}

interface StudentsHeaderProps {
  studentCount: number
  classCount: number
  currentTermName: string
  classes: Class[]
  statusCounts: StatusCounts
  activeStatusFilter: 'active' | 'withdrawn' | 'graduated' | 'all'
}

export default function StudentsHeader({ 
  studentCount, 
  classCount, 
  currentTermName, 
  classes,
  statusCounts,
  activeStatusFilter,
}: StudentsHeaderProps) {
  const router = useRouter()
  const [showAddModal, setShowAddModal] = useState(false)

  function handleAddSuccess() {
    setShowAddModal(false)
    router.refresh()
  }

  const filterLabel = {
    active: 'Active',
    withdrawn: 'Withdrawn',
    graduated: 'Graduated',
    all: 'All',
  }[activeStatusFilter]

  return (
    <>
      <header className="mb-6 flex items-start justify-between gap-4">
        <div className="flex-1">
          <h1 className="text-3xl font-bold text-navy">Students</h1>
          <p className="text-gray-500 mt-2 text-sm">
            {studentCount} {filterLabel.toLowerCase()} {studentCount === 1 ? 'student' : 'students'} across {classCount} {classCount === 1 ? 'class' : 'classes'} <span className="text-gray-400 font-bold">·</span> {currentTermName}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Status filter tabs */}
          <div className="flex items-center bg-gray-100 rounded-lg p-1 mr-2">
            <Link
              href="/students"
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                activeStatusFilter === 'active' 
                  ? 'bg-white text-navy shadow-sm' 
                  : 'text-gray-600 hover:text-navy'
              }`}
            >
              Active <span className="text-gray-400">({statusCounts.active})</span>
            </Link>
            <Link
              href="/students?status=withdrawn"
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                activeStatusFilter === 'withdrawn' 
                  ? 'bg-white text-navy shadow-sm' 
                  : 'text-gray-600 hover:text-navy'
              }`}
            >
              Withdrawn <span className="text-gray-400">({statusCounts.withdrawn})</span>
            </Link>
            <Link
              href="/students?status=graduated"
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                activeStatusFilter === 'graduated' 
                  ? 'bg-white text-navy shadow-sm' 
                  : 'text-gray-600 hover:text-navy'
              }`}
            >
              Graduated <span className="text-gray-400">({statusCounts.graduated})</span>
            </Link>
            <Link
              href="/students?status=all"
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                activeStatusFilter === 'all' 
                  ? 'bg-white text-navy shadow-sm' 
                  : 'text-gray-600 hover:text-navy'
              }`}
            >
              All <span className="text-gray-400">({statusCounts.all})</span>
            </Link>
          </div>

          <Link 
            href="/students/import"
            className="px-4 py-2 border border-gray-200 text-navy rounded-lg text-sm font-medium hover:bg-gray-50 flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Import CSV
          </Link>
          <button 
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 bg-mint text-navy rounded-lg text-sm font-semibold hover:bg-mint/90 flex items-center gap-1"
          >
            + Add student
          </button>
        </div>
      </header>

      {showAddModal && (
        <AddStudentModal
          classes={classes}
          onClose={() => setShowAddModal(false)}
          onSuccess={handleAddSuccess}
        />
      )}
    </>
  )
}