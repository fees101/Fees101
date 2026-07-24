// DEV-ONLY message simulator — gitignored, not committed, not deployed.
// In mock mode every "sent" message is stored in message_logs; this renders
// what a given phone number "received", like an SMS thread on their phone.
// Uses the service-role client so you don't need to log in as the school.

import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { normalizePhone } from '@/lib/messaging/sendMessage'

export const dynamic = 'force-dynamic'

interface Msg {
  id: string
  content: string
  message_type: string
  status: string
  provider_message_id: string | null
  created_at: string
}

export default async function SimulatorPage({ searchParams }: { searchParams: Promise<{ phone?: string }> }) {
  const { phone } = await searchParams
  const normalized = phone ? normalizePhone(phone) : ''

  let messages: Msg[] = []
  if (normalized) {
    const supabase = createServiceRoleClient()
    const { data } = await supabase
      .from('message_logs')
      .select('id, content, message_type, status, provider_message_id, created_at')
      .eq('recipient_phone', normalized)
      .order('created_at', { ascending: true })
    messages = (data || []) as Msg[]
  }

  const fmtTime = (s: string) => {
    const d = new Date(s)
    return isNaN(d.getTime()) ? '' : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  }

  return (
    <main style={{ minHeight: '100vh', background: '#0a1f44', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ color: '#fff', textAlign: 'center' }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>📱 Message Simulator</h1>
        <p style={{ fontSize: 13, opacity: 0.7, margin: '4px 0 0' }}>DEV only — shows what a number received in mock mode. Not committed.</p>
      </div>

      <div style={{ width: '100%', maxWidth: 420, background: '#fff', borderRadius: 14, padding: 16, boxShadow: '0 6px 20px rgba(0,0,0,0.25)' }}>
        <label htmlFor="phone" style={{ display: 'block', fontSize: 14, fontWeight: 700, color: '#0a1f44', marginBottom: 8 }}>
          Enter a parent&apos;s phone number
        </label>
        <form method="get" style={{ display: 'flex', gap: 8 }}>
          <input
            id="phone"
            name="phone"
            defaultValue={phone || ''}
            autoFocus
            placeholder="e.g. 08161111055"
            style={{ flex: 1, padding: '12px 14px', borderRadius: 10, border: '1px solid #c7c7cc', fontSize: 15, color: '#000' }}
          />
          <button type="submit" style={{ padding: '12px 18px', borderRadius: 10, border: 'none', background: '#6ee7b7', color: '#0a1f44', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            View messages
          </button>
        </form>
        <p style={{ fontSize: 12, color: '#8e8e93', margin: '8px 0 0' }}>
          Tip: grab the number from the student&apos;s family details, then send them an invoice (mock) to see it appear here.
        </p>
      </div>

      {/* Phone mockup */}
      <div style={{ width: '100%', maxWidth: 380, background: '#000', borderRadius: 36, padding: 10, boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
        <div style={{ background: '#f2f2f7', borderRadius: 28, overflow: 'hidden', height: 620, display: 'flex', flexDirection: 'column' }}>
          {/* Contact header */}
          <div style={{ background: '#fff', borderBottom: '1px solid #e5e5ea', padding: '14px 16px', textAlign: 'center' }}>
            <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#6ee7b7', color: '#0a1f44', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, margin: '0 auto 4px' }}>F</div>
            <div style={{ fontWeight: 600, fontSize: 15, color: '#000' }}>Fees101</div>
            <div style={{ fontSize: 11, color: '#8e8e93' }}>{normalized ? `to ${normalized}` : 'text message'}</div>
          </div>

          {/* Thread */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {!normalized ? (
              <p style={{ color: '#8e8e93', fontSize: 13, textAlign: 'center', marginTop: 40 }}>Enter a number above to see its messages.</p>
            ) : messages.length === 0 ? (
              <p style={{ color: '#8e8e93', fontSize: 13, textAlign: 'center', marginTop: 40 }}>No messages for {normalized} yet.<br />Send an invoice to this parent (mock mode) and refresh.</p>
            ) : (
              messages.map(m => {
                const isMock = (m.provider_message_id || '').startsWith('mock-')
                return (
                  <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', maxWidth: '85%' }}>
                    <div style={{ background: '#e5e5ea', color: '#000', padding: '9px 13px', borderRadius: 18, borderBottomLeftRadius: 4, fontSize: 14, lineHeight: 1.35, whiteSpace: 'pre-wrap' }}>
                      {m.content}
                    </div>
                    <div style={{ fontSize: 10, color: '#8e8e93', margin: '3px 0 0 6px' }}>
                      {fmtTime(m.created_at)} · {m.message_type} · {m.status}{isMock ? ' · mock' : ''}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
