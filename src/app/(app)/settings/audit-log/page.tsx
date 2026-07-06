import ComingSoonSettingsPage from '@/components/settings/ComingSoonSettingsPage'

export default function AuditLogSettingsPage() {
  return (
    <ComingSoonSettingsPage
      title="Audit log"
      subtitle="A full history of changes made in this account"
      icon="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
      description="See who changed a fee, recorded a payment, or marked an invoice sent — with a timestamp and before/after details for every action."
    />
  )
}
