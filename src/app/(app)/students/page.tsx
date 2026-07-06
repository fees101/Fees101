import { getStudents } from '@/lib/queries/students'
import StudentsTable from '@/components/students/StudentsTable'
import StudentsHeader from '@/components/students/StudentsHeader'

interface PageProps {
  searchParams: Promise<{ status?: string }>
}

export default async function StudentsPage({ searchParams }: PageProps) {
  const { status } = await searchParams
  const validStatus = (status === 'withdrawn' || status === 'graduated' || status === 'all') 
    ? status 
    : 'active'
  
  const { students, classes, currentTermName, classCount, statusCounts } = await getStudents(validStatus)

  return (
    <main className="px-6 py-6">
      <div className="max-w-[1440px] mx-auto">
        
        <StudentsHeader 
          studentCount={students.length}
          classCount={classCount}
          currentTermName={currentTermName}
          classes={classes}
          statusCounts={statusCounts}
          activeStatusFilter={validStatus}
        />

        <StudentsTable students={students} classes={classes} />

      </div>
    </main>
  )
}