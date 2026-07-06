'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { 
  updateStudentDetails, 
  updateFamilyInfo, 
  updateFamilyNotes, 
  updateStudentStatus,
  getClassesList
} from '@/app/(app)/students/[id]/actions'

interface Student {
  id: string
  firstName: string
  lastName: string
  admissionNumber: string
  classId: string
  className: string
  admissionDate: string
  status: string
  family: {
    id: string
    primaryParentName: string
    primaryParentPhone: string
    primaryParentEmail: string | null
    secondaryParentName: string | null
    secondaryParentPhone: string | null
    secondaryParentEmail: string | null
    notes: string | null
  }
}

interface Props {
  student: Student
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

export default function StudentSettingsTab({ student }: Props) {
  const router = useRouter()
  const [editingStudent, setEditingStudent] = useState(false)
  const [editingFamily, setEditingFamily] = useState(false)
  const [editingNotes, setEditingNotes] = useState(false)
  const [confirmAction, setConfirmAction] = useState<'withdrawn' | 'graduated' | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [classes, setClasses] = useState<{ id: string, name: string }[]>([])

  useEffect(() => {
    getClassesList().then(setClasses)
  }, [])

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
      
      {/* Left column: 3 cards */}
      <div className="lg:col-span-2 space-y-6">
        
        {/* Student details card */}
        <div className="bg-white p-6 rounded-xl border border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-navy font-semibold text-lg">Student details</h2>
            <button 
              onClick={() => setEditingStudent(true)}
              className="text-mint text-sm font-medium hover:underline"
            >
              Edit
            </button>
          </div>
          
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-gray-500 mb-1">First name</p>
              <p className="text-navy">{student.firstName}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Last name</p>
              <p className="text-navy">{student.lastName}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Admission number</p>
              <p className="text-navy">{student.admissionNumber}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Class</p>
              <p className="text-navy">{student.className}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Admission date</p>
              <p className="text-navy">{formatDate(student.admissionDate)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Status</p>
              <span className={`
                inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-medium rounded-full
                ${student.status === 'active' ? 'bg-mint-light text-mint' : ''}
                ${student.status === 'withdrawn' ? 'bg-red-100 text-red-700' : ''}
                ${student.status === 'graduated' ? 'bg-gray-100 text-gray-700' : ''}
              `}>
                <span className={`
                  w-1.5 h-1.5 rounded-full
                  ${student.status === 'active' ? 'bg-mint' : ''}
                  ${student.status === 'withdrawn' ? 'bg-red-500' : ''}
                  ${student.status === 'graduated' ? 'bg-gray-500' : ''}
                `}></span>
                {student.status}
              </span>
            </div>
          </div>
        </div>

        {/* Family info card */}
        <div className="bg-white p-6 rounded-xl border border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-navy font-semibold text-lg">Family information</h2>
            <button 
              onClick={() => setEditingFamily(true)}
              className="text-mint text-sm font-medium hover:underline"
            >
              Edit
            </button>
          </div>

          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Primary parent</p>
            <p className="text-navy font-medium mb-2">{student.family.primaryParentName}</p>
            <div className="space-y-1.5">
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
          </div>

          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Secondary parent</p>
            {student.family.secondaryParentName ? (
              <>
                <p className="text-navy font-medium mb-2">{student.family.secondaryParentName}</p>
                <div className="space-y-1.5">
                  {student.family.secondaryParentPhone && (
                    <p className="text-sm text-navy">{student.family.secondaryParentPhone}</p>
                  )}
                  {student.family.secondaryParentEmail && (
                    <p className="text-sm text-navy break-all">{student.family.secondaryParentEmail}</p>
                  )}
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-400 italic">No secondary parent added</p>
                <button 
                  onClick={() => setEditingFamily(true)}
                  className="text-mint text-sm font-medium hover:underline mt-2"
                >
                  + Add secondary parent
                </button>
              </>
            )}
          </div>
        </div>

        {/* Notes card */}
        <div className="bg-white p-6 rounded-xl border border-gray-200">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-navy font-semibold text-lg">Notes</h2>
            <button 
              onClick={() => setEditingNotes(true)}
              className="text-mint text-sm font-medium hover:underline"
            >
              Edit
            </button>
          </div>
          {student.family.notes ? (
            <p className="text-sm text-gray-700 leading-relaxed">{student.family.notes}</p>
          ) : (
            <p className="text-sm text-gray-400 italic">No notes yet</p>
          )}
        </div>

      </div>

      {/* Right column: Danger zone */}
      <div>
        <div className="bg-white p-6 rounded-xl border border-red-100">
          <h3 className="text-red-700 font-semibold mb-4">Danger zone</h3>
          
          <div className="pb-4 mb-4 border-b border-gray-100">
            <p className="text-sm font-medium text-navy mb-1">Mark as withdrawn</p>
            <p className="text-xs text-gray-500 mb-3">Student will no longer appear in active lists.</p>
            <button 
              onClick={() => setConfirmAction('withdrawn')}
              disabled={student.status === 'withdrawn'}
              className="px-3 py-1.5 border border-red-300 text-red-700 text-xs font-medium rounded-lg hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {student.status === 'withdrawn' ? 'Already withdrawn' : 'Mark withdrawn'}
            </button>
          </div>

          <div>
            <p className="text-sm font-medium text-navy mb-1">Mark as graduated</p>
            <p className="text-xs text-gray-500 mb-3">Move to graduates archive.</p>
            <button 
              onClick={() => setConfirmAction('graduated')}
              disabled={student.status === 'graduated'}
              className="px-3 py-1.5 border border-gray-300 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {student.status === 'graduated' ? 'Already graduated' : 'Mark graduated'}
            </button>
          </div>
        </div>
      </div>

      {/* Edit Student Modal */}
      {editingStudent && (
        <EditStudentModal 
          student={student}
          classes={classes}
          onClose={() => setEditingStudent(false)}
          onSave={() => { setEditingStudent(false); router.refresh() }}
        />
      )}

      {/* Edit Family Modal */}
      {editingFamily && (
        <EditFamilyModal 
          family={student.family}
          studentId={student.id}
          onClose={() => setEditingFamily(false)}
          onSave={() => { setEditingFamily(false); router.refresh() }}
        />
      )}

      {/* Edit Notes Modal */}
      {editingNotes && (
        <EditNotesModal 
          family={student.family}
          studentId={student.id}
          onClose={() => setEditingNotes(false)}
          onSave={() => { setEditingNotes(false); router.refresh() }}
        />
      )}

      {/* Confirm danger action modal */}
      {confirmAction && (
        <ConfirmStatusModal 
          studentId={student.id}
          studentName={`${student.firstName} ${student.lastName}`}
          action={confirmAction}
          onClose={() => setConfirmAction(null)}
          onConfirmed={() => { setConfirmAction(null); router.refresh() }}
        />
      )}
    </div>
  )
}

function EditStudentModal({ student, classes, onClose, onSave }: {
  student: Student
  classes: { id: string, name: string }[]
  onClose: () => void
  onSave: () => void
}) {
  const [form, setForm] = useState({
    firstName: student.firstName,
    lastName: student.lastName,
    admissionNumber: student.admissionNumber,
    classId: student.classId,
    admissionDate: student.admissionDate,
    status: student.status,
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    setError(null)
    setLoading(true)
    const result = await updateStudentDetails(student.id, form)
    if (result.error) {
      setError(result.error)
      setLoading(false)
      return
    }
    onSave()
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-navy">Edit student details</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">First name</label>
              <input type="text" value={form.firstName} onChange={(e) => setForm({...form, firstName: e.target.value})}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Last name</label>
              <input type="text" value={form.lastName} onChange={(e) => setForm({...form, lastName: e.target.value})}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40" />
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Admission number</label>
            <input type="text" value={form.admissionNumber} onChange={(e) => setForm({...form, admissionNumber: e.target.value})}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40" />
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Class</label>
            <select value={form.classId} onChange={(e) => setForm({...form, classId: e.target.value})}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40">
              {classes.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Admission date</label>
            <input type="date" value={form.admissionDate} onChange={(e) => setForm({...form, admissionDate: e.target.value})}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40" />
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Status</label>
            <select value={form.status} onChange={(e) => setForm({...form, status: e.target.value})}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40">
              <option value="active">Active</option>
              <option value="withdrawn">Withdrawn</option>
              <option value="graduated">Graduated</option>
            </select>
          </div>

          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}
        </div>

        <div className="p-6 border-t border-gray-100 flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={loading} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg">Cancel</button>
          <button onClick={handleSubmit} disabled={loading} className="px-4 py-2 bg-mint text-navy text-sm font-semibold rounded-lg hover:bg-mint/90 disabled:opacity-50">
            {loading ? 'Saving...' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

function EditFamilyModal({ family, studentId, onClose, onSave }: {
  family: Student['family']
  studentId: string
  onClose: () => void
  onSave: () => void
}) {
  const [form, setForm] = useState({
    primaryParentName: family.primaryParentName,
    primaryParentPhone: family.primaryParentPhone,
    primaryParentEmail: family.primaryParentEmail || '',
    secondaryParentName: family.secondaryParentName || '',
    secondaryParentPhone: family.secondaryParentPhone || '',
    secondaryParentEmail: family.secondaryParentEmail || '',
  })
  const [showSecondary, setShowSecondary] = useState(!!family.secondaryParentName)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    setError(null)
    setLoading(true)
    const result = await updateFamilyInfo(family.id, studentId, {
      ...form,
      secondaryParentName: showSecondary ? form.secondaryParentName : '',
      secondaryParentPhone: showSecondary ? form.secondaryParentPhone : '',
      secondaryParentEmail: showSecondary ? form.secondaryParentEmail : '',
    })
    if (result.error) {
      setError(result.error)
      setLoading(false)
      return
    }
    onSave()
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-navy">Edit family information</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-xs text-gray-500 uppercase tracking-wider">Primary parent</p>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Name</label>
            <input type="text" value={form.primaryParentName} onChange={(e) => setForm({...form, primaryParentName: e.target.value})}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40" />
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Phone</label>
            <input type="text" value={form.primaryParentPhone} onChange={(e) => setForm({...form, primaryParentPhone: e.target.value})}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40" />
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Email (optional)</label>
            <input type="email" value={form.primaryParentEmail} onChange={(e) => setForm({...form, primaryParentEmail: e.target.value})}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40" />
          </div>

          <div className="pt-4 border-t border-gray-100">
            {showSecondary ? (
              <>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs text-gray-500 uppercase tracking-wider">Secondary parent</p>
                  <button 
                    type="button" 
                    onClick={() => setShowSecondary(false)}
                    className="text-xs text-red-600 hover:underline"
                  >
                    Remove
                  </button>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Name</label>
                    <input type="text" value={form.secondaryParentName} onChange={(e) => setForm({...form, secondaryParentName: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Phone</label>
                    <input type="text" value={form.secondaryParentPhone} onChange={(e) => setForm({...form, secondaryParentPhone: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Email (optional)</label>
                    <input type="email" value={form.secondaryParentEmail} onChange={(e) => setForm({...form, secondaryParentEmail: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40" />
                  </div>
                </div>
              </>
            ) : (
              <button type="button" onClick={() => setShowSecondary(true)} className="text-mint text-sm font-medium hover:underline">
                + Add secondary parent
              </button>
            )}
          </div>

          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}
        </div>

        <div className="p-6 border-t border-gray-100 flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={loading} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg">Cancel</button>
          <button onClick={handleSubmit} disabled={loading} className="px-4 py-2 bg-mint text-navy text-sm font-semibold rounded-lg hover:bg-mint/90 disabled:opacity-50">
            {loading ? 'Saving...' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

function EditNotesModal({ family, studentId, onClose, onSave }: {
  family: Student['family']
  studentId: string
  onClose: () => void
  onSave: () => void
}) {
  const [notes, setNotes] = useState(family.notes || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    setError(null)
    setLoading(true)
    const result = await updateFamilyNotes(family.id, studentId, notes)
    if (result.error) {
      setError(result.error)
      setLoading(false)
      return
    }
    onSave()
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full">
        <div className="p-6 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-navy">Edit notes</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="p-6">
          <p className="text-xs text-gray-500 mb-2">Notes are visible to all staff with access to this student.</p>
          <textarea 
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={6}
            placeholder="Add notes about this family..."
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40 resize-none"
          />
          {error && <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}
        </div>

        <div className="p-6 border-t border-gray-100 flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={loading} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg">Cancel</button>
          <button onClick={handleSubmit} disabled={loading} className="px-4 py-2 bg-mint text-navy text-sm font-semibold rounded-lg hover:bg-mint/90 disabled:opacity-50">
            {loading ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ConfirmStatusModal({ studentId, studentName, action, onClose, onConfirmed }: {
  studentId: string
  studentName: string
  action: 'withdrawn' | 'graduated'
  onClose: () => void
  onConfirmed: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConfirm() {
    setError(null)
    setLoading(true)
    const result = await updateStudentStatus(studentId, action)
    if (result.error) {
      setError(result.error)
      setLoading(false)
      return
    }
    onConfirmed()
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
        <div className="p-6">
          <h3 className="text-lg font-semibold text-navy mb-2">
            Mark {studentName} as {action}?
          </h3>
          <p className="text-sm text-gray-600 mb-4">
            {action === 'withdrawn' 
              ? 'This student will no longer appear in active lists. You can reverse this from the Settings tab later.' 
              : 'This student will be moved to the graduates archive. You can reverse this from the Settings tab later.'}
          </p>
          {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}
          <div className="flex items-center justify-end gap-2">
            <button onClick={onClose} disabled={loading} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg">Cancel</button>
            <button onClick={handleConfirm} disabled={loading} className={`px-4 py-2 text-white text-sm font-semibold rounded-lg disabled:opacity-50 ${action === 'withdrawn' ? 'bg-red-600 hover:bg-red-700' : 'bg-navy hover:bg-navy/90'}`}>
              {loading ? 'Working...' : `Mark ${action}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}