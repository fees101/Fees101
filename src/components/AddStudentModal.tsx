'use client'

import { useState } from 'react'
import { addStudent } from '@/app/(app)/students/actions'

interface Class {
  id: string
  name: string
}

interface AddStudentModalProps {
  classes: Class[]
  onClose: () => void
  onSuccess: () => void
}

export default function AddStudentModal({ classes, onClose, onSuccess }: AddStudentModalProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showSecondary, setShowSecondary] = useState(false)

  async function handleSubmit(formData: FormData) {
    setLoading(true)
    setError(null)

    const result = await addStudent({
      firstName: formData.get('firstName') as string,
      lastName: formData.get('lastName') as string,
      admissionNumber: formData.get('admissionNumber') as string,
      classId: formData.get('classId') as string,
      admissionDate: formData.get('admissionDate') as string,
      primaryParentName: formData.get('primaryParentName') as string,
      primaryParentPhone: formData.get('primaryParentPhone') as string,
      primaryParentEmail: (formData.get('primaryParentEmail') as string) || undefined,
      secondaryParentName: (formData.get('secondaryParentName') as string) || undefined,
      secondaryParentPhone: (formData.get('secondaryParentPhone') as string) || undefined,
      secondaryParentEmail: (formData.get('secondaryParentEmail') as string) || undefined,
    })

    if (result.error) {
      setError(result.error)
      setLoading(false)
      return
    }

    onSuccess()
  }

  const today = new Date().toISOString().split('T')[0]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white">
          <h2 className="text-lg font-semibold text-navy">Add new student</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <form action={handleSubmit} className="p-6 space-y-6">
          
          {/* Student details */}
          <div>
            <h3 className="text-sm font-semibold text-navy mb-3">Student details</h3>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5 text-sm text-gray-700">
                <span>First name <span className="text-red-500">*</span></span>
                <input 
                  type="text" 
                  name="firstName" 
                  required
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-mint focus:ring-2 focus:ring-mint/20"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm text-gray-700">
                <span>Last name <span className="text-red-500">*</span></span>
                <input 
                  type="text" 
                  name="lastName" 
                  required
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-mint focus:ring-2 focus:ring-mint/20"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm text-gray-700">
                <span>Admission number <span className="text-red-500">*</span></span>
                <input 
                  type="text" 
                  name="admissionNumber" 
                  required
                  placeholder="2026/001"
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-mint focus:ring-2 focus:ring-mint/20"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm text-gray-700">
                <span>Class <span className="text-red-500">*</span></span>
                <select 
                  name="classId" 
                  required
                  defaultValue=""
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-mint focus:ring-2 focus:ring-mint/20"
                >
                  <option value="" disabled>Select class</option>
                  {classes.map(cls => (
                    <option key={cls.id} value={cls.id}>{cls.name}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-sm text-gray-700 col-span-2">
                <span>Admission date</span>
                <input 
                  type="date" 
                  name="admissionDate" 
                  defaultValue={today}
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-mint focus:ring-2 focus:ring-mint/20"
                />
              </label>
            </div>
          </div>

          {/* Primary parent */}
          <div>
            <h3 className="text-sm font-semibold text-navy mb-3">Primary parent</h3>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5 text-sm text-gray-700 col-span-2">
                <span>Parent name <span className="text-red-500">*</span></span>
                <input 
                  type="text" 
                  name="primaryParentName" 
                  required
                  placeholder="Mrs. Adesanya"
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-mint focus:ring-2 focus:ring-mint/20"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm text-gray-700">
                <span>Phone <span className="text-red-500">*</span></span>
                <input 
                  type="tel" 
                  name="primaryParentPhone" 
                  required
                  placeholder="+234 803 456 7890"
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-mint focus:ring-2 focus:ring-mint/20"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm text-gray-700">
                <span>Email</span>
                <input 
                  type="email" 
                  name="primaryParentEmail" 
                  placeholder="parent@example.com"
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-mint focus:ring-2 focus:ring-mint/20"
                />
              </label>
            </div>
          </div>

          {/* Secondary parent (collapsible) */}
          <div>
            {!showSecondary ? (
              <button
                type="button"
                onClick={() => setShowSecondary(true)}
                className="text-sm text-mint font-medium hover:underline"
              >
                + Add secondary parent
              </button>
            ) : (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-navy">Secondary parent</h3>
                  <button
                    type="button"
                    onClick={() => setShowSecondary(false)}
                    className="text-xs text-gray-500 hover:text-gray-700"
                  >
                    Remove
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1.5 text-sm text-gray-700 col-span-2">
                    <span>Parent name</span>
                    <input 
                      type="text" 
                      name="secondaryParentName"
                      placeholder="Mr. Adesanya"
                      className="px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-mint focus:ring-2 focus:ring-mint/20"
                    />
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm text-gray-700">
                    <span>Phone</span>
                    <input 
                      type="tel" 
                      name="secondaryParentPhone"
                      placeholder="+234 803 456 7890"
                      className="px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-mint focus:ring-2 focus:ring-mint/20"
                    />
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm text-gray-700">
                    <span>Email</span>
                    <input 
                      type="email" 
                      name="secondaryParentEmail"
                      placeholder="parent@example.com"
                      className="px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-mint focus:ring-2 focus:ring-mint/20"
                    />
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* Error message */}
          {error && (
            <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-gray-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-mint text-navy text-sm font-semibold rounded-lg hover:bg-mint/90 disabled:opacity-50"
            >
              {loading ? 'Adding...' : 'Add student'}
            </button>
          </div>

        </form>
      </div>
    </div>
  )
}