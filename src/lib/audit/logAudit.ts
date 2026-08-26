// Write-side of the audit log — best effort, never blocks the real action.
// Call this after a privileged mutation succeeds; a logging failure here
// must never surface as a failure of the action itself.

export interface LogAuditEventParams {
  schoolId: string
  actorId?: string | null   // omit/null for system-triggered actions (cron, webhooks) — no interactive actor
  actorName?: string        // pass if the caller already fetched it; otherwise looked up here
  action: string            // e.g. 'staff.role_changed', 'discount.approved'
  targetType?: string       // 'user' | 'role' | 'discount' | 'invoice'
  targetId?: string
  summary: string
  metadata?: Record<string, any>
}

export async function logAuditEvent(supabase: any, params: LogAuditEventParams): Promise<void> {
  try {
    let actorName = params.actorName
    if (!actorName) {
      if (params.actorId) {
        const { data: actor } = await supabase.from('users').select('name').eq('id', params.actorId).maybeSingle()
        actorName = actor?.name || 'Unknown user'
      } else {
        actorName = 'System'
      }
    }

    await supabase.from('audit_log').insert({
      school_id: params.schoolId,
      actor_id: params.actorId || null,
      actor_name: actorName,
      action: params.action,
      target_type: params.targetType,
      target_id: params.targetId,
      summary: params.summary,
      metadata: params.metadata,
    })
  } catch {
    // ignore logging errors — the underlying action already succeeded
  }
}
