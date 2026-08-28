import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { escalateFailedMessage } from '@/lib/messaging/sendMessage'

// Safety net for messages that a provider's gateway accepted ('sent') but
// never sent a delivery report for at all — the webhook-triggered path
// (e.g. api/webhooks/sendchamp/route.ts) only fires when a report actually
// arrives. Anything still 'sent' after 24h with no fallback attempt already
// chained off it gets treated as failed and escalated to the next channel.
async function runMessageSweep() {
  const supabase = createServiceRoleClient()
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const { data: stale } = await supabase
    .from('message_logs')
    .select('id, school_id, channel, message_type, content, related_student_id, related_invoice_id')
    .eq('status', 'sent')
    .lt('sent_at', cutoff)

  const { data: alreadyEscalated } = await supabase
    .from('message_logs')
    .select('fallback_of_message_id')
    .not('fallback_of_message_id', 'is', null)
  const escalatedIds = new Set((alreadyEscalated || []).map((r: any) => r.fallback_of_message_id))

  const candidates = (stale || []).filter((row: any) => !escalatedIds.has(row.id))

  for (const row of candidates) {
    await supabase
      .from('message_logs')
      .update({ status: 'failed', failed_reason: 'no delivery confirmation after 24h' })
      .eq('id', row.id)
    await escalateFailedMessage(supabase, row)
  }

  return { checked: stale?.length || 0, escalated: candidates.length }
}

// Manual/local trigger — same pattern as /api/admin/reminders' POST.
export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-message-sweep-secret')
  if (!secret || secret !== process.env.MESSAGE_SWEEP_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json(await runMessageSweep())
}

// Vercel Cron invokes with GET — see vercel.json for the schedule.
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json(await runMessageSweep())
}
