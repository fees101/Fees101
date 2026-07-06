import SettingsPageShell from './SettingsPageShell'

interface Props {
  title: string
  subtitle: string
  icon: string
  description: string
}

export default function ComingSoonSettingsPage({ title, subtitle, icon, description }: Props) {
  return (
    <SettingsPageShell title={title} subtitle={subtitle}>
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
        <div className="w-14 h-14 rounded-2xl bg-mint-light flex items-center justify-center mx-auto mb-4">
          <svg className="w-7 h-7 text-mint" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
          </svg>
        </div>
        <h2 className="text-navy font-semibold text-lg mb-2">{title}</h2>
        <p className="text-sm text-gray-500 max-w-md mx-auto">{description}</p>
        <span className="inline-block mt-4 text-xs px-2.5 py-1 bg-amber-50 text-amber-700 rounded-full font-medium">
          Coming soon
        </span>
      </div>
    </SettingsPageShell>
  )
}
