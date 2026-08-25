import { redirect } from 'next/navigation'
import CSVImportFlow from '@/components/students/CSVImportFlow'
import { getAuthContext, can } from '@/lib/auth/permissions'

export default async function ImportStudentsPage() {
  const ctx = await getAuthContext()
  if (!ctx) redirect('/login')
  if (!can(ctx, 'manage-students')) redirect('/students')

  return (
    <main className="px-6 py-6">
      <div className="max-w-[1440px] mx-auto">
        <CSVImportFlow />
      </div>
    </main>
  )
}