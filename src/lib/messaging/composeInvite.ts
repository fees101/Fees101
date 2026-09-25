import type { EmailContent } from './sendMessage'

// Staff-facing internal emails: onboarding (invite) and account-security
// notices. Kept in their own file so wording/branding stays independent of
// the parent-facing invoice/receipt templates in composeInvoice.ts.
//
// composeInviteEmail() is the actual staff-invite email a real invitee
// receives — team/users/actions.ts addStaff()/resendInvite() call
// generateLink() to get an action link, then send it through this template
// via sendEmail(), rather than relying on Supabase's dashboard-configured
// "Invite user" template.

const INK = '#201e1d'
const SECONDARY = '#605d5d'
const BODY_TEXT = '#3a3736'
const SURFACE = '#eae9e9'
const PAPER = '#f3f2f2'
const RULE = '#d7d3d3'
const RED = '#ec3013'
const EMAIL_FONT = 'font-family: Helvetica, Arial, sans-serif;'

function wordmark(): string {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;"><tr>` +
    `<td style="font-size:14px; font-weight:800; letter-spacing:0.14em; color:${INK}; ${EMAIL_FONT}">FEES101</td>` +
    `<td style="padding-left:9px;"><div style="width:24px; height:2px; line-height:2px; font-size:0; background-color:${RED};">&nbsp;</div></td>` +
    `</tr></table>`
  )
}

function primaryButton(url: string, label: string): string {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 0;"><tr><td>` +
    `<a href="${url}" style="display:inline-block; background-color:${INK}; color:${PAPER}; border:2px solid ${INK}; padding:13px 22px; font-size:15px; font-weight:600; text-decoration:none; ${EMAIL_FONT}">${label}</a>` +
    `</td></tr></table>`
  )
}

// Shared shell for every email in this file — a plain ink-bordered card led
// by the FEES101 wordmark, matching Messages.dc.html's "Staff invite" spec
// (no logo+school-name header like the parent-facing invoice emails; Fees101
// itself is the sender here, not the school).
function staffEmailShell(bodyHtml: string, footerText: string): string {
  return (
    `<!DOCTYPE html>` +
    `<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/></head>` +
    `<body style="margin:0; padding:0; background-color:${SURFACE}; ${EMAIL_FONT}">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${SURFACE};"><tr><td align="center" style="padding:32px 16px;">` +
    `<table role="presentation" width="680" cellpadding="0" cellspacing="0" style="max-width:680px; width:100%; background-color:#ffffff; border:2px solid ${INK};">` +

    `<tr><td style="padding:32px 32px 30px;">` +
    wordmark() +
    bodyHtml +
    `</td></tr>` +

    `<tr><td style="padding:16px 32px; background-color:${INK};">` +
    `<p style="margin:0; color:${RULE}; font-size:12px; line-height:1.6; ${EMAIL_FONT}">${footerText}</p>` +
    `</td></tr>` +

    `</table>` +
    `</td></tr></table>` +
    `</body></html>`
  )
}

function paragraph(html: string): string {
  return `<p style="margin:0 0 16px; color:${BODY_TEXT}; font-size:15px; line-height:1.6; ${EMAIL_FONT}">${html}</p>`
}

function reassurance(text: string): string {
  return `<p style="margin:18px 0 0; color:${SECONDARY}; font-size:13px; line-height:1.6; ${EMAIL_FONT}">${text}</p>`
}

const NOT_EXPECTING_FOOTER = 'Sent by <strong style="color:#ffffff;">Fees101</strong>. Not expecting this? Contact your school office.'

interface InviteEmailParams {
  schoolName: string
  roleName: string
  inviterName?: string
  actionUrl: string   // the Supabase-generated set-password / recovery link
}

export function composeInviteEmail(p: InviteEmailParams): EmailContent {
  const subject = p.inviterName ? `${p.inviterName} has added you to Fees101` : `You've been added to ${p.schoolName} on Fees101`
  const invitedBy = p.inviterName ? ` — ${p.inviterName}` : ''

  const text =
    `Hello,\n\n` +
    `You've been added${p.inviterName ? ` by ${p.inviterName}` : ''} to ${p.schoolName}'s account on Fees101 as ${p.roleName}.\n\n` +
    `To activate your login, set your password using the link below:\n` +
    `${p.actionUrl}\n\n` +
    `The link expires in 7 days. If you weren't expecting this, ignore it — nothing happens until you set a password.`

  const html = staffEmailShell(
    paragraph(
      `${invitedBy} has given you a <strong>${p.roleName}</strong> account for ${p.schoolName} on Fees101, where the school tracks fees.`,
    ) +
    primaryButton(p.actionUrl, 'Set your password') +
    reassurance("The link expires in 7 days. If you weren't expecting this, ignore it — nothing happens until you set a password."),
    NOT_EXPECTING_FOOTER,
  )

  return { subject, html, text }
}

export interface LockoutNoticeParams {
  schoolName: string
  lockedAccountName: string
  lockedAccountEmail: string
  lockedAt: string   // ISO timestamp
}

// Sent to the school owner the moment an account on their school hits the
// 5-failed-attempt lockout (loginRateLimit.ts). Not sent to the locked-out
// account itself — if that account IS the owner's own, this lands in the
// same inbox anyway.
export function composeLockoutEmail(p: LockoutNoticeParams): EmailContent {
  const subject = `${p.lockedAccountName}'s Fees101 login was locked after repeated failed attempts`
  const when = new Date(p.lockedAt).toLocaleString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })
  const text =
    `Hello,\n\n` +
    `${p.lockedAccountName} (${p.lockedAccountEmail}) on your Fees101 account, ${p.schoolName}, was locked out ` +
    `after five failed sign-in attempts in a row, on ${when}.\n\n` +
    `The account unlocks itself after 15 minutes. If this was really them mistyping their password, no action ` +
    `is needed. If it wasn't, reset their password from Settings -> Users.`
  const html = staffEmailShell(
    paragraph(
      `<strong>${p.lockedAccountName}</strong> (${p.lockedAccountEmail}) on your Fees101 account, <strong>${p.schoolName}</strong>, was locked out after five failed sign-in attempts in a row, on ${when}.`,
    ) +
    paragraph('The account unlocks itself after 15 minutes.') +
    reassurance(`<span style="color:#8a4805;">If this wasn't just a mistyped password, reset their password from Settings → Users.</span>`),
    'Automatic security notice from Fees101.',
  )
  return { subject, html, text }
}

export interface InviteExpiredNoticeParams {
  schoolName: string
  inviteeName: string
  inviteeEmail: string
}

// Sent to whoever originally invited a staff member (looked up from the
// audit log's most recent staff.added/staff.invite_resent entry for that
// account) when the invitee's link has expired before they could set a
// password — paired with an admin_notifications row so it also shows in the
// app's own notifications bell.
export function composeInviteExpiredEmail(p: InviteExpiredNoticeParams): EmailContent {
  const subject = `${p.inviteeName}'s invite to ${p.schoolName} expired`
  const text =
    `Hello,\n\n` +
    `${p.inviteeName} (${p.inviteeEmail}) tried to set up their Fees101 login for ${p.schoolName}, but the invite ` +
    `link had already expired.\n\n` +
    `Resend it from Settings -> Users -> Resend invite.`
  const html = staffEmailShell(
    paragraph(
      `<strong>${p.inviteeName}</strong> (${p.inviteeEmail}) tried to set up their Fees101 login for <strong>${p.schoolName}</strong>, but the invite link had already expired.`,
    ) +
    reassurance('Resend it from Settings → Users → Resend invite.'),
    'Automatic security notice from Fees101.',
  )
  return { subject, html, text }
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
    `Sign in going forward using ${p.newEmail}. If this wasn't expected, contact your school's Fees101 administrator immediately.`
  const html = staffEmailShell(
    paragraph(
      `<strong>${p.actorName}</strong> changed your Fees101 login email to this address (previously <strong>${p.oldEmail}</strong>).`,
    ) +
    paragraph(`Sign in going forward using <strong>${p.newEmail}</strong>.`) +
    reassurance(`<span style="color:#8a4805;">If you weren't expecting this, contact your school's Fees101 administrator immediately.</span>`),
    'Automatic security notice from Fees101.',
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
    `If you made this change (or asked an admin to), no action is needed. If you didn't expect this, contact your school's Fees101 administrator immediately.`
  const html = staffEmailShell(
    paragraph(
      `<strong>${p.actorName}</strong> changed the login email on your Fees101 account from this address to <strong>${p.newEmail}</strong>.`,
    ) +
    paragraph('If you made this change, no action is needed.') +
    reassurance(`<span style="color:#8a4805;">If you didn't expect this, contact your school's Fees101 administrator immediately.</span>`),
    'Automatic security notice from Fees101.',
  )
  return { subject, html, text }
}

export interface SchoolEmailVerificationParams {
  schoolName: string
  actionUrl: string
}

// Sent to the School profile "Email address" field whenever it's set or
// changed (school/actions.ts, updateSchoolGeneralInfo()) — this address is
// Fees101's own contact channel to the school, not a login credential, so
// there's nothing to protect by verifying it; the point is purely making
// sure it's a real, reachable inbox rather than a typo, so we're never stuck
// unable to reach the school if we need to.
export function composeSchoolEmailVerification(p: SchoolEmailVerificationParams): EmailContent {
  const subject = `Confirm the contact email for ${p.schoolName} on Fees101`
  const text =
    `Hello,\n\n` +
    `This address was just set as ${p.schoolName}'s contact email on Fees101. Confirm it's correct by opening ` +
    `the link below:\n${p.actionUrl}\n\n` +
    `If you didn't expect this, ignore this email — nothing changes until the link is opened.`
  const html = staffEmailShell(
    paragraph(`This address was just set as <strong>${p.schoolName}</strong>'s contact email on Fees101.`) +
    primaryButton(p.actionUrl, 'Confirm this email') +
    reassurance("If you didn't expect this, ignore it — nothing changes until the link is opened."),
    NOT_EXPECTING_FOOTER,
  )
  return { subject, html, text }
}
