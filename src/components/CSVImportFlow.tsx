'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { parseAndValidateCSV, importStudents } from '@/app/(app)/students/import/actions'

interface ParsedRow {
  rowNumber: number
  firstName: string
  lastName: string
  admissionNumber: string
  className: string
  admissionDate: string
  parentName: string
  parentPhone: string
  parentEmail: string
  secondaryParentName: string
  secondaryParentPhone: string
  secondaryParentEmail: string
  notes: string
  errors: string[]
  classId?: string
}

type Step = 'upload' | 'review' | 'success'

export default function CSVImportFlow() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('upload')
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [summary, setSummary] = useState({ total: 0, valid: 0, invalid: 0 })
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [importResult, setImportResult] = useState<{ imported: number, failed: number, schoolName: string, breakdown: Record<string, number>} | null>(null)
  const [dragging, setDragging] = useState(false)

  async function handleFile(file: File) {
    setError(null)
    setLoading(true)

    if (!file.name.endsWith('.csv')) {
      setError('Please upload a CSV file')
      setLoading(false)
      return
    }

    if (file.size > 5 * 1024 * 1024) {
      setError('File size must be under 5MB')
      setLoading(false)
      return
    }

    try {
      const text = await file.text()
      const result = await parseAndValidateCSV(text)

      if (result.error) {
        setError(result.error)
        setLoading(false)
        return
      }

      if (!result.rows || result.rows.length === 0) {
        setError('No data rows found in the file')
        setLoading(false)
        return
      }

      setRows(result.rows)
      setSummary(result.summary!)
      setStep('review')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read file')
    } finally {
      setLoading(false)
    }
  }

  async function handleConfirmImport() {
    setLoading(true)
    setError(null)

    const result = await importStudents(rows)

    if (result.error) {
      setError(result.error)
      setLoading(false)
      return
    }

    setImportResult({
    imported: result.imported || 0,
    failed: result.failed || 0,
    schoolName: result.schoolName || 'your school',
    breakdown: result.breakdown || {},
    })
    setStep('success')
    setLoading(false)
  }

  function handleStartOver() {
    setStep('upload')
    setRows([])
    setSummary({ total: 0, valid: 0, invalid: 0 })
    setError(null)
    setImportResult(null)
  }

  return (
    <>
      {/* Breadcrumb */}
      <nav className="mb-4 flex items-center gap-2 text-sm text-gray-500">
        <Link href="/students" className="hover:text-navy">Students</Link>
        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-navy font-medium">Import</span>
      </nav>

      <h1 className="text-3xl font-bold text-navy mb-2">Import Students</h1>
      <p className="text-gray-500 text-sm mb-8">Upload a CSV file to add multiple students at once</p>

      {/* Step indicator */}
      <div className="flex items-center justify-center gap-2 mb-8 max-w-2xl mx-auto">
        <StepIndicator number={1} label="Download template" status={step === 'upload' ? 'active' : 'complete'} />
        <div className={`flex-1 h-px ${step !== 'upload' ? 'bg-mint' : 'bg-gray-200'}`} />
        <StepIndicator number={2} label="Upload file" status={step === 'upload' ? 'pending' : step === 'review' ? 'active' : 'complete'} />
        <div className={`flex-1 h-px ${step === 'success' ? 'bg-mint' : 'bg-gray-200'}`} />
        <StepIndicator number={3} label="Review & confirm" status={step === 'success' ? 'complete' : step === 'review' ? 'active' : 'pending'} />
      </div>

      {/* Content based on step */}
      {step === 'upload' && (
        <UploadStep 
          onFileSelect={handleFile}
          dragging={dragging}
          setDragging={setDragging}
          error={error}
          loading={loading}
        />
      )}

      {step === 'review' && (
        <ReviewStep
          rows={rows}
          summary={summary}
          onConfirm={handleConfirmImport}
          onCancel={handleStartOver}
          loading={loading}
          error={error}
        />
      )}

        {step === 'success' && importResult && (
        <SuccessStep
            imported={importResult.imported}
            failed={importResult.failed}
            schoolName={importResult.schoolName}
            breakdown={importResult.breakdown}
            onViewStudents={() => router.push('/students')}
            onImportMore={handleStartOver}
        />
        )}
    </>
  )
}

function StepIndicator({ number, label, status }: { number: number, label: string, status: 'pending' | 'active' | 'complete' }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className={`
        w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold
        ${status === 'complete' ? 'bg-mint text-navy' : ''}
        ${status === 'active' ? 'bg-navy text-white' : ''}
        ${status === 'pending' ? 'bg-gray-100 text-gray-400' : ''}
      `}>
        {status === 'complete' ? (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          number
        )}
      </div>
      <span className={`text-xs ${status === 'pending' ? 'text-gray-400' : 'text-navy'}`}>{label}</span>
    </div>
  )
}

function UploadStep({ onFileSelect, dragging, setDragging, error, loading }: {
  onFileSelect: (file: File) => void
  dragging: boolean
  setDragging: (b: boolean) => void
  error: string | null
  loading: boolean
}) {
  return (
    <div className="space-y-6">
    {/* Template + how it works + warning cards */}
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
    
    {/* Card 1: Template download */}
    <div className="bg-white p-6 rounded-xl border border-gray-200">
        <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-mint-light flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-mint" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
        </div>
        <div className="flex-1">
            <h3 className="text-navy font-semibold">Need a template?</h3>
            <p className="text-sm text-gray-500 mt-1 mb-4">Download our CSV template with example data</p>
            <a 
            href="/students-template.csv" 
            download
            className="inline-flex items-center gap-2 px-4 py-2 bg-mint-light text-mint text-sm font-semibold rounded-lg hover:bg-mint-light/70"
            >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Download template
            </a>
        </div>
        </div>
    </div>

    {/* Card 2: How it works */}
    <div className="bg-white p-6 rounded-xl border border-gray-200">
        <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 rounded-lg bg-mint-light flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-mint" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
        </div>
        <h3 className="text-navy font-semibold">How it works</h3>
        </div>
        <ol className="text-sm text-gray-700 space-y-1.5">
        <li><span className="text-gray-400 mr-2">1</span>Download the template</li>
        <li><span className="text-gray-400 mr-2">2</span>Fill in your student data</li>
        <li><span className="text-gray-400 mr-2">3</span>Upload the file</li>
        <li><span className="text-gray-400 mr-2">4</span>Review and confirm imports</li>
        </ol>
    </div>

    {/* Card 3: Excel warning */}
    <div className="bg-white p-6 rounded-xl border border-gray-200">
        <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
        </div>
        <h3 className="text-navy font-semibold">A note on Excel</h3>
        </div>
        <p className="text-sm text-gray-700 mb-2">
        Excel can corrupt phone numbers and dates when opening CSVs.
        </p>
        <p className="text-sm text-gray-700">
        We recommend using <strong>Google Sheets</strong> or a plain text editor instead. See our guide for tips →
        </p>
    </div>

    </div>
      {/* Drop zone */}
      
      <div 
        className={`
          bg-white p-12 rounded-xl border-2 border-dashed text-center transition-colors
          ${dragging ? 'border-mint bg-mint-light' : 'border-gray-300'}
        `}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          const file = e.dataTransfer.files[0]
          if (file) onFileSelect(file)
        }}
      >
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-mint-light flex items-center justify-center">
          <svg className="w-8 h-8 text-mint" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
          </svg>
        </div>
        <p className="text-lg font-semibold text-navy mb-1">Drop your CSV file here</p>
        <p className="text-sm text-gray-500 mb-1">or click to browse</p>
        <p className="text-xs text-gray-400 mb-4">Accepts .csv files up to 5MB</p>
        <label className="inline-flex items-center gap-2 px-4 py-2 bg-mint text-navy text-sm font-semibold rounded-lg hover:bg-mint/90 cursor-pointer">
          {loading ? 'Reading file...' : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              Choose file
            </>
          )}
          <input
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) onFileSelect(file)
            }}
            disabled={loading}
          />
        </label>
        {error && (
          <p className="mt-4 text-sm text-red-700 bg-red-50 px-4 py-2 rounded-lg inline-block">{error}</p>
        )}
      </div>

      {/* What you need */}
      <div className="bg-white p-6 rounded-xl border border-gray-200">
        <h3 className="text-navy font-semibold mb-3">What you need</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-gray-500 font-medium uppercase mb-2">Required</p>
            <ul className="text-sm text-gray-700 space-y-1.5">
              <li>✓ Student first name</li>
              <li>✓ Student last name</li>
              <li>✓ Admission number</li>
              <li>✓ Class (must match an existing class)</li>
              <li>✓ Parent name</li>
              <li>✓ Parent phone (Nigerian format)</li>
            </ul>
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium uppercase mb-2">Optional</p>
            <ul className="text-sm text-gray-700 space-y-1.5">
              <li>· Parent email</li>
              <li>· Date of admission</li>
              <li>· Secondary parent contact</li>
              <li>· Notes</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}

function ReviewStep({ rows, summary, onConfirm, onCancel, loading, error }: {
  rows: ParsedRow[]
  summary: { total: number, valid: number, invalid: number }
  onConfirm: () => void
  onCancel: () => void
  loading: boolean
  error: string | null
}) {
  return (
    <div>
      <h2 className="text-2xl font-bold text-navy mb-1">Review your import</h2>
      <p className="text-gray-500 text-sm mb-6">
        We found {summary.total} {summary.total === 1 ? 'student' : 'students'} in your file.
        {summary.invalid > 0 && ` ${summary.invalid} need attention.`}
      </p>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white p-4 rounded-xl border border-gray-200 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-mint-light flex items-center justify-center">
            <svg className="w-5 h-5 text-mint" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <p className="text-2xl font-bold text-navy">{summary.valid}</p>
            <p className="text-xs text-gray-500">Ready to import</p>
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-gray-200 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
            <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M5 19h14a2 2 0 002-2v-12a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <p className="text-2xl font-bold text-navy">{summary.invalid}</p>
            <p className="text-xs text-gray-500">Need attention</p>
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-gray-200 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
            <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <div>
            <p className="text-2xl font-bold text-navy">0</p>
            <p className="text-xs text-gray-500">Errors</p>
          </div>
        </div>
      </div>

      {/* Rows table */}
      <div className="bg-white rounded-xl border border-gray-200 mb-6 overflow-hidden">
        <div className="overflow-x-auto max-h-[500px]">
          <table className="w-full">
            <thead className="bg-gray-50 sticky top-0">
              <tr className="border-b border-gray-200">
                <th className="text-left text-xs text-gray-500 uppercase font-medium px-3 py-2.5 w-12">Row</th>
                <th className="text-left text-xs text-gray-500 uppercase font-medium px-3 py-2.5">Student name</th>
                <th className="text-left text-xs text-gray-500 uppercase font-medium px-3 py-2.5">Class</th>
                <th className="text-left text-xs text-gray-500 uppercase font-medium px-3 py-2.5">Parent name</th>
                <th className="text-left text-xs text-gray-500 uppercase font-medium px-3 py-2.5">Phone</th>
                <th className="text-left text-xs text-gray-500 uppercase font-medium px-3 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row) => (
                <tr key={row.rowNumber} className={row.errors.length > 0 ? 'bg-amber-50' : ''}>
                  <td className="px-3 py-2 text-sm text-gray-500">{row.rowNumber}</td>
                  <td className="px-3 py-2 text-sm text-navy">{row.firstName} {row.lastName}</td>
                  <td className="px-3 py-2 text-sm text-gray-700">{row.className || '—'}</td>
                  <td className="px-3 py-2 text-sm text-gray-700">{row.parentName || '—'}</td>
                  <td className="px-3 py-2 text-sm text-gray-700">{row.parentPhone || '—'}</td>
                  <td className="px-3 py-2">
                    {row.errors.length === 0 ? (
                      <svg className="w-5 h-5 text-mint" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <div className="flex items-start gap-2">
                        <svg className="w-5 h-5 text-amber-600 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        <div>
                          {row.errors.map((err, idx) => (
                            <p key={idx} className="text-xs text-amber-700">{err}</p>
                          ))}
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={onConfirm}
          disabled={loading || summary.valid === 0}
          className="px-6 py-2.5 bg-mint text-navy text-sm font-semibold rounded-lg hover:bg-mint/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Importing...' : summary.invalid > 0 ? `Skip flagged rows and import ${summary.valid}` : `Import ${summary.valid} students`}
        </button>
        <button
          onClick={onCancel}
          disabled={loading}
          className="px-6 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-lg"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function SuccessStep({ imported, failed, schoolName, breakdown, onViewStudents, onImportMore }: {
  imported: number
  failed: number
  schoolName: string
  breakdown: Record<string, number>
  onViewStudents: () => void
  onImportMore: () => void
}) {
  // Sort classes by count desc, then alphabetically
  const sortedClasses = Object.entries(breakdown).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1]
    return a[0].localeCompare(b[0])
  })

  return (
    <div className="max-w-xl mx-auto text-center py-8">
      <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-mint flex items-center justify-center">
        <svg className="w-10 h-10 text-navy" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>

      <h2 className="text-3xl font-bold text-navy mb-2">Import successful</h2>
      <p className="text-gray-500 mb-8">
        {imported} {imported === 1 ? 'student' : 'students'} added to {schoolName}
        {failed > 0 && `, ${failed} ${failed === 1 ? 'row' : 'rows'} failed`}
      </p>

      {sortedClasses.length > 0 && (
        <div className="bg-white p-6 rounded-xl border border-gray-200 mb-8 text-left">
          <h3 className="text-navy font-semibold mb-4">Import summary</h3>
          <div className="space-y-1 max-h-80 overflow-y-auto">
            {sortedClasses.map(([className, count]) => (
              <div key={className} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-mint-light flex items-center justify-center flex-shrink-0">
                    <svg className="w-4 h-4 text-mint" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                  </div>
                  <span className="text-sm font-medium text-navy">{className}</span>
                </div>
                <span className="text-sm text-gray-700">
                  {count} {count === 1 ? 'student' : 'students'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {failed > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-8 text-sm text-amber-800">
          {failed} {failed === 1 ? 'row' : 'rows'} could not be imported. Check your data and try again.
        </div>
      )}

      <div className="flex items-center justify-center gap-3">
        <button
          onClick={onViewStudents}
          className="px-6 py-2.5 bg-mint text-navy text-sm font-semibold rounded-lg hover:bg-mint/90"
        >
          View all students
        </button>
        <button
          onClick={onImportMore}
          className="px-6 py-2.5 border border-gray-200 text-navy text-sm font-medium rounded-lg hover:bg-gray-50"
        >
          Import more
        </button>
      </div>
    </div>
  )
}