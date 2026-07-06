import CSVImportFlow from '@/components/students/CSVImportFlow'

export default function ImportStudentsPage() {
  return (
    <main className="px-6 py-6">
      <div className="max-w-[1440px] mx-auto">
        <CSVImportFlow />
      </div>
    </main>
  )
}