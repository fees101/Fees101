import type { EmailContent } from './sendMessage'

// Staff-facing invite email. Unlike the parent invoice/receipt emails, this is
// an internal onboarding message: it welcomes a new team member and carries the
// one-time set-password link that activates their login. Kept in its own file
// so its wording and branding stay independent of the parent-facing templates.

const SIGNATURE = 'Powered by Fees101'

interface InviteEmailParams {
  schoolName: string
  roleName: string
  inviterName?: string
  actionUrl: string   // the Supabase-generated set-password / recovery link
}

function inviteWrapper(schoolName: string, bodyHtml: string): string {
  return (
    `<!DOCTYPE html>` +
    `<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/></head>` +
    `<body style="margin:0; padding:0; background-color:#f3f4f6; font-family: Helvetica, Arial, sans-serif;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6; padding:32px 16px;">` +
    `<tr><td align="center">` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%; background-color:#ffffff; border-radius:8px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,0.08);">` +

    // Header band
    `<tr><td style="background-color:#0D1B36; padding:24px 32px;">` +
    `<p style="margin:0; color:#ffffff; font-size:18px; font-weight:bold;">${schoolName}</p>` +
    `<p style="margin:4px 0 0; color:#9CA8C0; font-size:12px;">Team invitation</p>` +
    `</td></tr>` +

    // Body
    `<tr><td style="padding:32px; color:#0D1B36; font-size:14px; line-height:1.7;">` +
    `${bodyHtml}` +
    `</td></tr>` +

    // Footer
    `<tr><td style="padding:20px 32px; background-color:#f9fafb; border-top:1px solid #e5e7eb;">` +
    `<p style="margin:0; color:#6b7280; font-size:12px; line-height:1.6;">` +
    `You're receiving this because someone at <strong>${schoolName}</strong> added you to their Fees101 account.<br/>` +
    `If you weren't expecting this, you can safely ignore this email — the link won't do anything until you use it.` +
    `</p>` +
    `<p style="margin:16px 0 0; color:#9CA8C0; font-size:11px;">${SIGNATURE}</p>` +
    `</td></tr>` +

    `</table>` +
    `</td></tr>` +
    `</table>` +
    `</body></html>`
  )
}

function ctaButton(url: string, label: string): string {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">` +
    `<tr><td style="border-radius:6px; background-color:#0D1B36;">` +
    `<a href="${url}" style="display:inline-block; padding:12px 28px; color:#ffffff; font-size:14px; font-weight:bold; text-decoration:none; border-radius:6px;">${label}</a>` +
    `</td></tr></table>`
  )
}

export function composeInviteEmail(p: InviteEmailParams): EmailContent {
  const subject = `You've been added to ${p.schoolName} on Fees101`
  const invitedBy = p.inviterName ? ` by ${p.inviterName}` : ''

  const text =
    `Hello,\n\n` +
    `You've been added${invitedBy} to ${p.schoolName}'s account on Fees101 as ${p.roleName}.\n\n` +
    `To activate your login, set your password using the link below:\n` +
    `${p.actionUrl}\n\n` +
    `Once your password is set you can sign in and start helping manage fees, students and invoices.\n\n` +
    `If you weren't expecting this, you can safely ignore this email.\n\n` +
    `${SIGNATURE}`

  const html = inviteWrapper(
    p.schoolName,
    `<p style="margin:0 0 12px;">Hello,</p>` +
    `<p style="margin:0 0 12px;">You've been added${invitedBy ? `<strong>${invitedBy}</strong>` : ''} to <strong>${p.schoolName}</strong>'s account on Fees101 as <strong>${p.roleName}</strong>.</p>` +
    `<p style="margin:0 0 12px;">To activate your login, set your password:</p>` +
    ctaButton(p.actionUrl, 'Set your password') +
    `<p style="margin:12px 0 0; color:#6b7280; font-size:12px;">Or paste this link into your browser:<br/>` +
    `<a href="${p.actionUrl}" style="color:#1D4ED8; word-break:break-all;">${p.actionUrl}</a></p>`,
  )

  return { subject, html, text }
}
