// Read-side of the audit log — powers the /settings/audit-log page.
// actor_name is denormalized on the row at write time, so no join needed here
// (unlike report_downloads, which joins users in JS because it doesn't
// denormalize the name).

import { createClient } from '@/lib/supabase/server'
import { getAuthContext } from '@/lib/auth/permissions'

export interface AuditLogRow {
  id: string
  actorName: string
  action: string
  targetType: string | null
  targetId: string | null
  summary: string
  metadata: Record<string, any> | null
  createdAt: string
}

export interface GetAuditLogOptions {
  limit?: number
  offset?: number
  action?: string
  actorId?: string
  // OR'd together as a "starts with" match (e.g. ['class.', 'section.'] for
  // the "Classes & sections" category) — see AUDIT_LOG_GROUPS.
  actionPrefixes?: string[]
  from?: string // yyyy-mm-dd, inclusive
  to?: string   // yyyy-mm-dd, inclusive (end of day)
}

export interface AuditLogPage {
  events: AuditLogRow[]
  total: number
}

export async function getAuditLog(opts: GetAuditLogOptions = {}): Promise<AuditLogPage> {
  const ctx = await getAuthContext()
  if (!ctx?.schoolId) return { events: [], total: 0 }

  const supabase = await createClient()
  let q = supabase
    .from('audit_log')
    .select('id, actor_name, action, target_type, target_id, summary, metadata, created_at', { count: 'exact' })
    .eq('school_id', ctx.schoolId)
    .order('created_at', { ascending: false })

  if (opts.action) q = q.eq('action', opts.action)
  if (opts.actorId) q = q.eq('actor_id', opts.actorId)
  if (opts.actionPrefixes?.length) {
    q = q.or(opts.actionPrefixes.map(p => `action.like.${p}%`).join(','))
  }
  if (opts.from) q = q.gte('created_at', opts.from)
  if (opts.to) q = q.lte('created_at', `${opts.to}T23:59:59.999Z`)

  const limit = opts.limit ?? 100
  const offset = opts.offset ?? 0
  q = q.range(offset, offset + limit - 1)

  const { data, count } = await q

  return {
    events: (data || []).map((r: any) => ({
      id: r.id,
      actorName: r.actor_name,
      action: r.action,
      targetType: r.target_type,
      targetId: r.target_id,
      summary: r.summary,
      metadata: r.metadata,
      createdAt: r.created_at,
    })),
    total: count ?? 0,
  }
}
