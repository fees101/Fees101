'use client'

import { useState } from 'react'
import SessionsTab from './SessionsTab'
import SectionsTab from './SectionsTab'
import ClassesTable from '@/components/ClassesTable'
import { SessionRow } from '@/lib/queries/fees'

interface ClassRow {
  id: string
  name: string
  displayOrder: number
  isActive: boolean
  sectionId: string
  sectionName: string
  studentCount: number
  feeItemCount: number
}

interface Section {
  id: string
  name: string
}

interface Props {
  classes: ClassRow[]
  sections: Section[]
  sessions: SessionRow[]
  classCounts: Record<string, number>
  termCounts: Record<string, number>
}

const TABS = [
  { id: 'sessions', label: 'Sessions' },
  { id: 'sections', label: 'Sections' },
  { id: 'classes', label: 'Classes' },
] as const

type TabId = typeof TABS[number]['id']

export default function AcademicStructureLayout({ classes, sections, sessions, classCounts, termCounts }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('sessions')

  return (
    <div>
      <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 mb-5 w-fit max-w-full overflow-x-auto">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3.5 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
              activeTab === tab.id ? 'bg-white text-navy shadow-sm' : 'text-gray-600 hover:text-navy'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'sessions' && <SessionsTab sessions={sessions} termCounts={termCounts} />}
      {activeTab === 'sections' && <SectionsTab sections={sections} classCounts={classCounts} />}
      {activeTab === 'classes' && <ClassesTable classes={classes} sections={sections} />}
    </div>
  )
}
