import { getStudents } from '@/lib/queries/students'
import StudentsTable from '@/components/StudentsTable'
import StudentsHeader from '@/components/StudentsHeader'

export default async function StudentsPage() {
  const { students, classes, currentTermName, classCount } = await getStudents()

  return (
    <main className="px-6 py-6">
      <div className="max-w-7xl mx-auto">
        
        <StudentsHeader 
          studentCount={students.length}
          classCount={classCount}
          currentTermName={currentTermName}
          classes={classes}
        />

        <StudentsTable students={students} classes={classes} />

      </div>
    </main>
  )
}