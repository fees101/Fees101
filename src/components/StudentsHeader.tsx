'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import AddStudentModal from './AddStudentModal'

interface Class {
  id: string
  name: string
}

interface StudentsHeaderProps {
  studentCount: number
  classCount: number
  currentTermName: string
  classes: Class[]
}

export default function StudentsHeader({ studentCount, classCount, currentTermName, classes }: StudentsHeaderProps) {
  const router = useRouter()
  const [showAddModal, setShowAddModal] = useState(false)

  function handleAddSuccess() {
    setShowAddModal(false)
    router.refresh()
  }

  return (
    <>
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-navy">Students</h1>
          <p className="text-gray-500 mt-2 text-sm">
            {studentCount} {studentCount === 1 ? 'student' : 'students'} across {classCount} {classCount === 1 ? 'class' : 'classes'} · {currentTermName}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="px-4 py-2 border border-gray-200 text-navy rounded-lg text-sm font-medium hover:bg-gray-50 flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Import CSV
          </button>
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