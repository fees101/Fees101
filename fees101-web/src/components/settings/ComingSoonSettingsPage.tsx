import SettingsPageShell from './SettingsPageShell'

interface Props {
  title: string
  subtitle: string
  icon: string
  description: string
  workspaceKey?: 'school' | 'team'
}

export default function ComingSoonSettingsPage({ title, subtitle, description, workspaceKey = 'school' }: Props) {
  return (
    <SettingsPageShell workspaceKey={workspaceKey} title={title} subtitle={subtitle}>
      <div className="border-2 border-[var(--color-ink)] p-12 text-center">
        <h2 className="text-lg font-extrabold tracking-[-0.01em] text-[var(--color-ink)] mb-2">{title}</h2>
        <p className="text-sm text-[var(--color-neutral-700)] max-w-md mx-auto">{description}</p>
        <span className="m-chip m-chip-neutral inline-flex mt-4">Coming soon</span>
      </div>
    </SettingsPageShell>
  )
}
