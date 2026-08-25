import type { EmailContent } from './sendMessage'

// Staff-facing internal emails: onboarding (invite) and account-security
// notices. Kept in their own file so wording/branding stays independent of
// the parent-facing invoice/receipt templates in composeInvoice.ts.

const SIGNATURE = 'Powered by Fees101'
const SIGNATURE_HTML = 'Powered by Fees<span style="color:#5AD8A6; font-weight:bold;">101</span>'

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

// Account-security notice: sent when an admin changes a staff member's login
// email (settings/users/actions.ts, updateStaffEmail()). Supabase's own
// "Email address changed" notification (Authentication > Emails) was
// confirmed NOT to fire for this admin-initiated updateUserById() path
// (only self-service changes trigger it) — this fills that gap with our own
// send, to both the old and new address.
function securityWrapper(bodyHtml: string): string {
  return (
    `<!DOCTYPE html>` +
    `<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/></head>` +
    `<body style="margin:0; padding:0; background-color:#f3f4f6; font-family: Helvetica, Arial, sans-serif;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6; padding:32px 16px;">` +
    `<tr><td align="center">` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%; background-color:#ffffff; border-radius:8px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,0.08);">` +

    `<tr><td style="background-color:#0D1B36; padding:24px 32px;">` +
    `<p style="margin:0; color:#ffffff; font-size:18px; font-weight:bold;">Fees101</p>` +
    `<p style="margin:4px 0 0; color:#9CA8C0; font-size:12px;">Security notice</p>` +
    `</td></tr>` +

    `<tr><td style="height:4px; line-height:4px; font-size:0; background-color:#5AD8A6;">&nbsp;</td></tr>` +

    `<tr><td style="padding:32px; color:#0D1B36; font-size:14px; line-height:1.7;">` +
    `${bodyHtml}` +
    `</td></tr>` +

    `<tr><td style="padding:20px 32px; background-color:#f9fafb; border-top:1px solid #e5e7eb;">` +
    `<p style="margin:0; color:#6b7280; font-size:12px; line-height:1.6;">` +
    `This is an automatic security notification sent whenever the login email on a Fees101 account changes.` +
    `</p>` +
    `<p style="margin:16px 0 0; color:#9CA8C0; font-size:11px;">${SIGNATURE_HTML}</p>` +
    `</td></tr>` +

    `</table>` +
    `</td></tr>` +
    `</table>` +
    `</body></html>`
  )
}

export interface EmailChangedNoticeParams {
  oldEmail: string
  newEmail: string
  actorName: string
}

// To the new address: tells them their login now uses this address, so it
// isn't a silent change they'd only discover by trying to sign in.
export function composeEmailChangedToNewAddress(p: EmailChangedNoticeParams): EmailContent {
  const subject = 'Your Fees101 login email was changed'
  const text =
    `Hello,\n\n` +
    `${p.actorName} changed your Fees101 login email to this address (previously ${p.oldEmail}).\n\n` +
    `Sign in going forward using ${p.newEmail}. If this wasn't expected, contact your school's Fees101 administrator immediately.\n\n${SIGNATURE}`
  const html = securityWrapper(
    `<p style="margin:0 0 12px;">Hello,</p>` +
    `<p style="margin:0 0 12px;"><strong>${p.actorName}</strong> changed your Fees101 login email to this address (previously <strong>${p.oldEmail}</strong>).</p>` +
    `<p style="margin:0 0 12px;"><span style="display:inline-block; background-color:#E8F8F1; color:#0D1B36; padding:4px 12px; border-radius:6px; font-size:13px; font-weight:bold;">Sign in going forward using ${p.newEmail}.</span></p>` +
    `<p style="margin:20px 0 0; color:#b91c1c; font-size:13px;">If you weren't expecting this, contact your school's Fees101 administrator immediately.</p>`
  )
  return { subject, html, text }
}

// To the old address: the security alert Supabase's native notification
// would have sent if it fired for this path — the surface most likely to
// catch an unauthorized change, since the account holder still reads it.
export function composeEmailChangedToOldAddress(p: EmailChangedNoticeParams): EmailContent {
  const subject = 'Your Fees101 login email was changed'
  const text =
    `Hello,\n\n` +
    `${p.actorName} changed the login email on your Fees101 account from this address to ${p.newEmail}.\n\n` +
    `If you made this change (or asked an admin to), no action is needed. If you didn't expect this, contact your school's Fees101 administrator immediately.\n\n${SIGNATURE}`
  const html = securityWrapper(
    `<p style="margin:0 0 12px;">Hello,</p>` +
    `<p style="margin:0 0 12px;"><strong>${p.actorName}</strong> changed the login email on your Fees101 account from this address to <strong>${p.newEmail}</strong>.</p>` +
    `<p style="margin:0 0 12px;"><span style="display:inline-block; background-color:#E8F8F1; color:#0D1B36; padding:4px 12px; border-radius:6px; font-size:13px; font-weight:bold;">If you made this change, no action is needed.</span></p>` +
    `<p style="margin:20px 0 0; color:#b91c1c; font-size:13px;">If you didn't expect this, contact your school's Fees101 administrator immediately.</p>`
  )
  return { subject, html, text }
}
