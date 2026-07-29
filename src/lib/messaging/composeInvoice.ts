// Message text for every outbound message type.
//
// SMS: sent under our approved custom Sender ID ("OE Alert" — see
// TERMII_SENDER_ID). "NGN" (not the ₦ sign) keeps SMS in the cheap GSM-7
// encoding — ₦ forces costlier Unicode segments.
//
// Email: HTML+text pair sent via Amazon SES (see sendMessage.ts /
// ses.ts) with the invoice/receipt PDF as an attachment — the SMS
// covers the quick alert, the email delivers the actual document, so the
// email body itself stays short and points at the attachment rather than
// repeating every line item.

const SIGNATURE = 'Powered by Fees101'

// A single GSM-7 SMS segment caps at 160 chars; going over silently splits
// the message into 2+ billed segments. The "Hello {{name}}" / signature
// wording is fixed and must never be shortened — the school name is the only
// variable-length part we control, so getSchoolSmsName() keeps that short
// (custom short name, or an auto-abbreviation of the full name).
const MAX_SCHOOL_NAME_CHARS = 30

function safeSchoolName(name: string): string {
  return name.length > MAX_SCHOOL_NAME_CHARS ? name.slice(0, MAX_SCHOOL_NAME_CHARS - 1) + '…' : name
}

function withSignature(body: string): string {
  return `${body}\n\n${SIGNATURE}`
}

function amount(n: number): string {
  return Math.max(0, Math.round(n)).toLocaleString('en-NG')
}

function shortDate(dateStr: string): string {
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export interface InvoiceMessageParams {
  studentName: string
  schoolName: string
  termName: string
  amountDue: number
  dueDate: string
  accountNumber: string
  bankName: string
}

export function composeInvoiceSMS(p: InvoiceMessageParams): string {
  return withSignature(
    `Hello ${p.studentName}, your ${safeSchoolName(p.schoolName)} ${p.termName} fees invoice is ` +
    `NGN ${amount(p.amountDue)}, due ${shortDate(p.dueDate)}. ` +
    `Pay to ${p.accountNumber} (${p.bankName}).`
  )
}

export interface PartialPaymentMessageParams {
  studentName: string
  schoolName: string
  amountPaid: number
  balance: number
  accountNumber: string
}

export function composePartialPaymentSMS(p: PartialPaymentMessageParams): string {
  return withSignature(
    `Hello ${p.studentName}, NGN ${amount(p.amountPaid)} received for your ${safeSchoolName(p.schoolName)} fees. ` +
    `Balance: NGN ${amount(p.balance)}. Pay to ${p.accountNumber}.`
  )
}

export interface FullPaymentMessageParams {
  studentName: string
  schoolName: string
  termName: string
  amountPaid: number
}

export function composeFullPaymentSMS(p: FullPaymentMessageParams): string {
  return withSignature(
    `Hello ${p.studentName}, NGN ${amount(p.amountPaid)} received. ` +
    `Your ${safeSchoolName(p.schoolName)} ${p.termName} fees are fully paid. Thank you.`
  )
}

export interface ReminderMessageParams {
  studentName: string
  schoolName: string
  termName: string
  balance: number
  dueDate: string
  accountNumber: string
}

export function composeReminderSMS(p: ReminderMessageParams): string {
  return withSignature(
    `Hello ${p.studentName}, your ${safeSchoolName(p.schoolName)} ${p.termName} fees of NGN ${amount(p.balance)} ` +
    `are due ${shortDate(p.dueDate)}. Pay to ${p.accountNumber}.`
  )
}

export function composeOverdueSMS(p: ReminderMessageParams): string {
  return withSignature(
    `Hello ${p.studentName}, your ${safeSchoolName(p.schoolName)} ${p.termName} fees of NGN ${amount(p.balance)} ` +
    `were due ${shortDate(p.dueDate)}. Pay to ${p.accountNumber}.`
  )
}

export interface EmailBody {
  subject: string
  html: string
  text: string
}

// Shared layout: a centered 600px card (the email-safe width every major
// inbox renders consistently) with a school-branded header band, a details
// table for the figures that matter, and a footer that credits both the
// school and Fees101 — parents should read this as coming from the school,
// with Fees101 as the platform behind it, not the other way round.
function emailWrapper(schoolName: string, bodyHtml: string, footNote?: string): string {
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
    `<p style="margin:4px 0 0; color:#9CA8C0; font-size:12px;">School Fees Notification</p>` +
    `</td></tr>` +

    // Body
    `<tr><td style="padding:32px; color:#0D1B36; font-size:14px; line-height:1.7;">` +
    `${bodyHtml}` +
    `</td></tr>` +

    // Footer
    `<tr><td style="padding:20px 32px; background-color:#f9fafb; border-top:1px solid #e5e7eb;">` +
    `<p style="margin:0; color:#6b7280; font-size:12px; line-height:1.6;">` +
    (footNote ? `${footNote}<br/><br/>` : '') +
    `This is an automated message from <strong>${schoolName}</strong>, sent on their behalf via Fees101.<br/>` +
    `If you believe you received this in error, or have questions about this invoice, please contact the school office directly.` +
    `</p>` +
    `<p style="margin:16px 0 0; color:#9CA8C0; font-size:11px;">${SIGNATURE}</p>` +
    `</td></tr>` +

    `</table>` +
    `</td></tr>` +
    `</table>` +
    `</body></html>`
  )
}

function detailRow(label: string, value: string, emphasize?: boolean): string {
  return (
    `<tr>` +
    `<td style="padding:10px 0; border-bottom:1px solid #e5e7eb; color:#6b7280; font-size:13px;">${label}</td>` +
    `<td style="padding:10px 0; border-bottom:1px solid #e5e7eb; text-align:right; font-size:${emphasize ? '16px' : '14px'}; font-weight:${emphasize ? 'bold' : 'normal'}; color:${emphasize ? '#0D1B36' : '#111827'};">${value}</td>` +
    `</tr>`
  )
}

function detailsTable(rowsHtml: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;">${rowsHtml}</table>`
}

function attachmentNotice(label: string): string {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0; background-color:#EFF6FF; border-radius:6px; width:100%;">` +
    `<tr><td style="padding:14px 16px; color:#1D4ED8; font-size:13px;">` +
    `📎 <strong>${label}</strong> is attached to this email as a PDF — please keep a copy for your records.` +
    `</td></tr></table>`
  )
}

export function composeInvoiceEmail(p: InvoiceMessageParams): EmailBody {
  const schoolName = p.schoolName
  const subject = `${schoolName} — ${p.termName} Fees Invoice for ${p.studentName}`
  const text =
    `Dear Parent/Guardian,\n\n` +
    `Please find attached the ${p.termName} fees invoice for ${p.studentName} at ${schoolName}.\n\n` +
    `-----------------------------------\n` +
    `INVOICE SUMMARY\n` +
    `-----------------------------------\n` +
    `Student:       ${p.studentName}\n` +
    `Term:          ${p.termName}\n` +
    `Amount due:    NGN ${amount(p.amountDue)}\n` +
    `Due date:      ${shortDate(p.dueDate)}\n` +
    `Payment account: ${p.accountNumber} (${p.bankName})\n` +
    `-----------------------------------\n\n` +
    `A detailed PDF breakdown of this invoice is attached to this email for your records.\n\n` +
    `Kindly make payment on or before the due date to avoid a late reminder. If you have already paid, please disregard this notice — payments are usually reflected automatically within a few minutes.\n\n` +
    `If you have any questions about this invoice, please reach out to the school office directly.\n\n` +
    `Thank you for your continued partnership with ${schoolName}.\n\n` +
    `Warm regards,\n${schoolName}\n\n${SIGNATURE}`
  const html = emailWrapper(
    schoolName,
    `<p style="margin:0 0 16px;">Dear Parent/Guardian,</p>` +
    `<p style="margin:0 0 8px;">Please find below the <strong>${p.termName}</strong> fees invoice for <strong>${p.studentName}</strong> at <strong>${schoolName}</strong>.</p>` +
    detailsTable(
      detailRow('Student', p.studentName) +
      detailRow('Term', p.termName) +
      detailRow('Amount due', `NGN ${amount(p.amountDue)}`, true) +
      detailRow('Due date', shortDate(p.dueDate)) +
      detailRow('Payment account', `${p.accountNumber} (${p.bankName})`)
    ) +
    attachmentNotice('The full invoice') +
    `<p style="margin:20px 0 0;">Kindly make payment on or before the due date to avoid a late reminder. If you have already paid, please disregard this notice — payments are usually reflected automatically within a few minutes.</p>` +
    `<p style="margin:16px 0 0;">If you have any questions about this invoice, please reach out to the school office directly.</p>` +
    `<p style="margin:24px 0 0;">Thank you for your continued partnership with <strong>${schoolName}</strong>.</p>` +
    `<p style="margin:20px 0 0;">Warm regards,<br/><strong>${schoolName}</strong></p>`
  )
  return { subject, html, text }
}

export function composeFullPaymentEmail(p: FullPaymentMessageParams): EmailBody {
  const subject = `${p.schoolName} — Payment Receipt for ${p.studentName} (${p.termName})`
  const text =
    `Dear Parent/Guardian,\n\n` +
    `We are pleased to confirm that payment has been received in full for ${p.studentName}'s ${p.termName} fees at ${p.schoolName}.\n\n` +
    `-----------------------------------\n` +
    `PAYMENT RECEIPT\n` +
    `-----------------------------------\n` +
    `Student:       ${p.studentName}\n` +
    `Term:          ${p.termName}\n` +
    `Amount paid:   NGN ${amount(p.amountPaid)}\n` +
    `Status:        Fully paid\n` +
    `-----------------------------------\n\n` +
    `Your official receipt is attached to this email as a PDF for your records.\n\n` +
    `Thank you for your prompt payment and for being a valued part of the ${p.schoolName} community.\n\n` +
    `Warm regards,\n${p.schoolName}\n\n${SIGNATURE}`
  const html = emailWrapper(
    p.schoolName,
    `<p style="margin:0 0 16px;">Dear Parent/Guardian,</p>` +
    `<p style="margin:0 0 8px;">We are pleased to confirm that payment has been received <strong>in full</strong> for <strong>${p.studentName}</strong>'s <strong>${p.termName}</strong> fees at <strong>${p.schoolName}</strong>.</p>` +
    detailsTable(
      detailRow('Student', p.studentName) +
      detailRow('Term', p.termName) +
      detailRow('Amount paid', `NGN ${amount(p.amountPaid)}`, true) +
      detailRow('Status', '<span style="color:#16a34a; font-weight:bold;">Fully paid ✓</span>')
    ) +
    attachmentNotice('Your official receipt') +
    `<p style="margin:20px 0 0;">Thank you for your prompt payment and for being a valued part of the <strong>${p.schoolName}</strong> community.</p>` +
    `<p style="margin:20px 0 0;">Warm regards,<br/><strong>${p.schoolName}</strong></p>`
  )
  return { subject, html, text }
}

export function composePartialPaymentEmail(p: PartialPaymentMessageParams): EmailBody {
  const subject = `${p.schoolName} — Payment Received for ${p.studentName}`
  const text =
    `Dear Parent/Guardian,\n\n` +
    `We have received a payment towards ${p.studentName}'s fees at ${p.schoolName}. Thank you.\n\n` +
    `-----------------------------------\n` +
    `PAYMENT RECEIPT\n` +
    `-----------------------------------\n` +
    `Student:          ${p.studentName}\n` +
    `Amount paid:      NGN ${amount(p.amountPaid)}\n` +
    `Remaining balance: NGN ${amount(p.balance)}\n` +
    `Payment account:  ${p.accountNumber}\n` +
    `-----------------------------------\n\n` +
    `Your receipt for this payment is attached to this email as a PDF for your records.\n\n` +
    `Kindly clear the remaining balance at your earliest convenience using the payment account above.\n\n` +
    `Thank you for your continued partnership with ${p.schoolName}.\n\n` +
    `Warm regards,\n${p.schoolName}\n\n${SIGNATURE}`
  const html = emailWrapper(
    p.schoolName,
    `<p style="margin:0 0 16px;">Dear Parent/Guardian,</p>` +
    `<p style="margin:0 0 8px;">We have received a payment towards <strong>${p.studentName}</strong>'s fees at <strong>${p.schoolName}</strong>. Thank you.</p>` +
    detailsTable(
      detailRow('Student', p.studentName) +
      detailRow('Amount paid', `NGN ${amount(p.amountPaid)}`, true) +
      detailRow('Remaining balance', `NGN ${amount(p.balance)}`, true) +
      detailRow('Payment account', p.accountNumber)
    ) +
    attachmentNotice('Your receipt for this payment') +
    `<p style="margin:20px 0 0;">Kindly clear the remaining balance at your earliest convenience using the payment account above.</p>` +
    `<p style="margin:20px 0 0;">Thank you for your continued partnership with <strong>${p.schoolName}</strong>.</p>` +
    `<p style="margin:20px 0 0;">Warm regards,<br/><strong>${p.schoolName}</strong></p>`
  )
  return { subject, html, text }
}
