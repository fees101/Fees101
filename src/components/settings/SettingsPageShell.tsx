import SettingsNav from './SettingsNav'

interface Props {
  title: string
  subtitle: string
  children: React.ReactNode
}

export default function SettingsPageShell({ title, subtitle, children }: Props) {
  return (
    <main className="px-4 sm:px-6 py-6">
      <div className="max-w-[1440px] mx-auto">
        <header className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-navy">{title}</h1>
          <p className="text-gray-500 mt-2 text-sm">{subtitle}</p>
        </header>

        <div className="flex flex-col lg:flex-row gap-6 items-start">
          <SettingsNav />
          <div className="flex-1 min-w-0 w-full">
            {children}
          </div>
        </div>
      </div>
    </main>
  )
}
