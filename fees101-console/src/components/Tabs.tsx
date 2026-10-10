'use client'

import { useState } from 'react'

export interface TabDef {
  key: string
  label: string
  count?: number
  content: React.ReactNode
}

// Splits a page into scannable sections instead of one long scroll —
// 2026-10-10, owner feedback: "we need to see things work not just scrolling
// through a long list of pages thats buried information." Client-side tab
// state only (no route change) since every tab's data is already fetched by
// the server component that renders <Tabs>; switching tabs never refetches.
export default function Tabs({ tabs, defaultKey }: { tabs: TabDef[]; defaultKey?: string }) {
  const [active, setActive] = useState(defaultKey ?? tabs[0]?.key)
  const current = tabs.find(t => t.key === active) ?? tabs[0]

  return (
    <div>
      <div className="tabs">
        {tabs.map(t => (
          <button
            key={t.key}
            type="button"
            className="tab"
            data-active={t.key === active}
            onClick={() => setActive(t.key)}
          >
            {t.label}
            {typeof t.count === 'number' && <span className="tab-count">{t.count}</span>}
          </button>
        ))}
      </div>
      {current?.content}
    </div>
  )
}
