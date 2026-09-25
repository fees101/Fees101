import WorkspaceHeader from '@/components/layout/WorkspaceHeader'

interface Props {
  workspaceKey: 'school' | 'team'
  title: string
  subtitle?: string
  children: React.ReactNode
}

export default function SettingsPageShell({ workspaceKey, title, subtitle, children }: Props) {
  return (
    <>
      <WorkspaceHeader workspaceKey={workspaceKey} title={title} />
      <div className="px-4 sm:px-7 py-7">
        <div className="max-w-[1100px]">
          {subtitle && (
            <p className="text-sm text-[var(--color-neutral-700)] mb-6">{subtitle}</p>
          )}
          {children}
        </div>
      </div>
    </>
  )
}
