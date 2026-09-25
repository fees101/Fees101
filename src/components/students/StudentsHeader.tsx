'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import WorkspaceHeader from '@/components/layout/WorkspaceHeader'
import AddStudentModal from './AddStudentModal'
import { useCan } from '@/lib/auth/PermissionsProvider'

interface Class {
  id: string
  name: string
}

interface StudentsHeaderProps {
  classes: Class[]
}

// The Students header is now just the workspace title + primary actions. The
// old Active / Withdrawn / Graduated tab row that used to sit under it has
// moved into the roster's "More filters" control (the App Shell roster has no
// second tab row — it filters inline), so the lifecycle status is still fully
// reachable, just no longer a permanent strip of tabs.
export default function StudentsHeader({ classes }: StudentsHeaderProps) {
  const router = useRouter()
  const [showAddModal, setShowAddModal] = useState(false)
  const canManageStudents = useCan('manage-students')

  function handleAddSuccess() {
    setShowAddModal(false)
    router.refresh()
  }

  return (
    <>
      <WorkspaceHeader
        workspaceKey="students"
        title="Students"
        actions={
          canManageStudents ? (
            <>
              <Link href="/students/import" className="m-btn m-btn-outline">
                Import CSV
              </Link>
              <button onClick={() => setShowAddModal(true)} className="m-btn m-btn-primary">
                Add student
              </button>
            </>
          ) : undefined
        }
      />

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
