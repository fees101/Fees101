// Message text for every outbound message type.
//
// SMS: sent under our own custom Sendchamp Sender ID ("Fees101", see
// SENDCHAMP_SENDER_ID). Since it's our own approved ID, not a shared one,
// there's no signature line needed and no fixed-template constraint like
// Termii had. Every template is written to fit inside one GSM-7 segment
// (160 characters) at realistic worst-case name lengths: "NGN" (not the ₦
// sign) keeps the encoding in the cheap 7-bit charset, and the text avoids
// any character outside it (no curly quotes, no em/en dashes, no ellipsis).
// Sendchamp's hard cap is 320 chars/message; ours stays under 160 so it
// never bills as a second segment.
//
// Email: HTML+text pair sent via Brevo (see sendMessage.ts / brevo.ts) with
// the invoice/receipt PDF as an attachment. The SMS covers the quick alert,
// the email delivers the actual document, so the email body itself stays
// short and points at the attachment rather than repeating every line item.
// The HTML is table-based (email clients don't render flexbox or grid) and
// uses the product's ink-on-paper palette directly, since email clients
// can't load an external stylesheet.

const MAX_SCHOOL_NAME_CHARS = 30
const MAX_SMS_CHARS = 160

// Truncates with three ASCII periods rather than the single-character
// ellipsis. That character falls outside the GSM-7 charset and would
// silently force an SMS into costlier Unicode encoding. Three periods keep
// the same 30-character ceiling used everywhere else in this file.
function safeSchoolName(name: string): string {
  return name.length > MAX_SCHOOL_NAME_CHARS
    ? name.slice(0, MAX_SCHOOL_NAME_CHARS - 3) + '...'
    : name
}

// Last-resort safety net for the handful of templates built from more than
// one free-text field (a student's full name, a school's own term name).
// Neither is length-limited at entry, so no fixed combination of them can be
// proven short by construction. Whatever the inputs, the segment limit is
// not negotiable: trim to it rather than silently letting the SMS provider
// bill (and split) a second segment.
function capSmsLength(text: string): string {
  return text.length > MAX_SMS_CHARS ? text.slice(0, MAX_SMS_CHARS - 3) + '...' : text
}

// The design leads every message with the student's first name (a parent
// reading "Chidinma's fees" doesn't need the surname repeated) and keeps
// the full name only in structured, tabular contexts (ledger rows, the PDF).
function firstName(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0]
  return first || fullName
}

function amount(n: number): string {
  return Math.max(0, Math.round(n)).toLocaleString('en-NG')
}

function nairaAmount(n: number): string {
  return `₦${amount(n)}`
}

// Same as nairaAmount, but keeps the sign for a fee-breakdown row that can
// legitimately be negative (a credit line item reduces the total).
function nairaAmountSigned(n: number): string {
  return n < 0 ? `-₦${amount(Math.abs(n))}` : nairaAmount(n)
}

// "Wema Bank" -> "Wema" for SMS, where a full bank name can run long enough
// on its own to push a worst-case name combination past one segment. The
// email keeps the full bank name.
function bankFirstWord(bankName: string): string {
  return bankName.trim().split(/\s+/)[0] || bankName
}

// Groups a 10-digit NUBAN as "8142 556 301" for the email, where legibility
// matters more than compactness. SMS keeps the digits run together, as
// before: every character there is billed.
function spacedAccountNumber(accountNumber: string): string {
  const digits = accountNumber.replace(/\D/g, '')
  if (digits.length !== 10) return accountNumber
  return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`
}

const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// Month/weekday names are hardcoded (rather than via Intl) for the same
// reason as src/lib/format/date.ts: a fixed lookup table can't disagree
// with itself the way ICU builds sometimes do between environments. This
// file needs weekday names and no-year dates that formatDate() doesn't
// produce, so it keeps its own small table rather than reshaping that
// shared helper's output for every other caller.
function parseDate(dateStr: string): Date | null {
  const d = new Date(dateStr)
  return isNaN(d.getTime()) ? null : d
}

// "Fri 28 Mar", for SMS, where every character is billed.
function smsDate(dateStr: string): string {
  const d = parseDate(dateStr)
  if (!d) return dateStr
  return `${WEEKDAYS_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`
}

// "28 March", for subject lines, where the year is redundant context.
function dateNoYear(dateStr: string): string {
  const d = parseDate(dateStr)
  if (!d) return dateStr
  return `${d.getDate()} ${MONTHS_LONG[d.getMonth()]}`
}

// "Friday 28 March", for the email body, set beside a day-count.
function emailDueLine(dateStr: string): string {
  const d = parseDate(dateStr)
  if (!d) return dateStr
  return `${WEEKDAYS_LONG[d.getDay()]} ${d.getDate()} ${MONTHS_LONG[d.getMonth()]}`
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

// "Fri 28 Mar 2026, 3:45pm", for a payment receipt, where the exact time can
// matter for reconciling against a bank statement. Same no-Intl approach as
// formatDateTime in src/lib/format/date.ts, kept local to this file for the
// reason explained above parseDate().
function emailDateTime(dateStr: string): string {
  const d = parseDate(dateStr)
  if (!d) return dateStr
  const hours24 = d.getHours()
  const period = hours24 >= 12 ? 'pm' : 'am'
  const hours12 = hours24 % 12 || 12
  return (
    `${WEEKDAYS_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}, ` +
    `${hours12}:${pad2(d.getMinutes())}${period}`
  )
}

// Calendar-day difference between today and the given date (ignores time of
// day on both sides). Positive means the date is still ahead of today.
function daysUntil(dateStr: string): number {
  const d = parseDate(dateStr)
  if (!d) return 0
  const today = new Date()
  const ms = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
    - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.round(ms / 86_400_000)
}

// A due date on a lock-screen preview asks the parent to do the subtraction
// themselves; a day-count doesn't.
function countdownPhrase(days: number): string {
  if (days > 1) return `${days} days from now`
  if (days === 1) return 'tomorrow'
  if (days === 0) return 'today'
  const overdue = Math.abs(days)
  return `${overdue} day${overdue === 1 ? '' : 's'} overdue`
}

export interface InvoiceMessageParams {
  studentName: string
  parentName?: string
  schoolName: string
  termName: string
  amountDue: number
  dueDate: string
  accountNumber: string
  bankName: string
  logoUrl?: string | null
  // The student's class, e.g. "JSS 2". Email/PDF room only, never the SMS.
  className?: string
  // The invoice's fee-by-fee makeup (required fees, opt-ins, previous
  // balance, credit applied), same shape computeInvoice.ts already
  // produces. Email/PDF room only; the SMS stays a one-line total.
  lineItems?: Array<{ name: string; amount: number; kind?: string }>
  // Set when this send is a deliberate resend of an invoice whose numbers
  // changed after it was already sent (fee edit, opt-in, carry-forward,
  // credit shift). Surfaces the credit movement so the change doesn't read
  // as a mistake to the parent.
  isUpdate?: boolean
  creditApplied?: number
  creditBalance?: number
}

export function composeInvoiceSMS(p: InvoiceMessageParams): string {
  const base =
    `${safeSchoolName(p.schoolName)}: ${firstName(p.studentName)}'s ${p.termName} fees are ` +
    `NGN ${amount(p.amountDue)}, due ${smsDate(p.dueDate)}. Pay to ${p.accountNumber} (${bankFirstWord(p.bankName)}).`

  if (!(p.isUpdate && (p.creditApplied || p.creditBalance))) return capSmsLength(base)

  const fullNote =
    ` Updated: NGN ${amount(p.creditApplied || 0)} credit applied, balance now NGN ${amount(p.creditBalance || 0)}.`
  if ((base + fullNote).length <= MAX_SMS_CHARS) return base + fullNote

  // The full credit note spells out two amounts, which is what pushes a
  // long school/student/term combination past one GSM-7 segment. The exact
  // numbers are always in the email and PDF, so fall back to a short,
  // fixed-length flag rather than risk an amount getting cut off mid-digit.
  // capSmsLength is still the final word: if even this doesn't fit (an
  // already-long base on top of it), it trims cleanly.
  const shortNote = ' Updated, see email.'
  return capSmsLength(base + shortNote)
}

export interface PartialPaymentMessageParams {
  studentName: string
  parentName?: string
  schoolName: string
  amountPaid: number
  balance: number
  accountNumber: string
  logoUrl?: string | null
  // The current invoice's due date, so the balance reminder doesn't read as
  // open-ended. Optional: a payment can land against an invoice with no
  // due date set yet.
  dueDate?: string
}

export function composePartialPaymentSMS(p: PartialPaymentMessageParams): string {
  const dueClause = p.dueDate ? ` by ${smsDate(p.dueDate)}` : ''
  return capSmsLength(
    `${safeSchoolName(p.schoolName)}: NGN ${amount(p.amountPaid)} received for ${firstName(p.studentName)}, ` +
    `thank you. NGN ${amount(p.balance)} still to pay${dueClause}. Pay to ${p.accountNumber}.`
  )
}

export interface FullPaymentMessageParams {
  studentName: string
  parentName?: string
  schoolName: string
  termName: string
  amountPaid: number
  logoUrl?: string | null
  // Email/PDF room only. Kept off the SMS, which stays a one-line thank-you.
  paidAt?: string
  accountNumber?: string
  reference?: string
}

export function composeFullPaymentSMS(p: FullPaymentMessageParams): string {
  return (
    `${safeSchoolName(p.schoolName)}: NGN ${amount(p.amountPaid)} received for ${firstName(p.studentName)}, ` +
    `thank you. ${p.termName} fees are fully paid.`
  )
}

export interface ReminderMessageParams {
  studentName: string
  parentName?: string
  schoolName: string
  termName: string
  balance: number
  dueDate: string
  accountNumber: string
  // The DVA's bank, so the reminder repeats which bank the account number
  // belongs to rather than the number alone. Optional: a very old invoice
  // sent before DVA provisioning may not have it.
  bankName?: string
}

// "8142556301 (Wema)" when the bank is known, otherwise just the number.
function payToPhrase(accountNumber: string, bankName?: string): string {
  return bankName ? `${accountNumber} (${bankFirstWord(bankName)})` : accountNumber
}

export function composeReminderSMS(p: ReminderMessageParams): string {
  const days = daysUntil(p.dueDate)
  const whenPhrase = days > 1
    ? `due in ${days} days, ${smsDate(p.dueDate)}`
    : days === 1
      ? `due tomorrow, ${smsDate(p.dueDate)}`
      : `due ${smsDate(p.dueDate)}`
  return capSmsLength(
    `${safeSchoolName(p.schoolName)}: ${firstName(p.studentName)}'s fees of NGN ${amount(p.balance)} are ` +
    `${whenPhrase}. Pay to ${payToPhrase(p.accountNumber, p.bankName)}.`
  )
}

export function composeOverdueSMS(p: ReminderMessageParams): string {
  const overdueDays = Math.max(1, -daysUntil(p.dueDate))
  return capSmsLength(
    `${safeSchoolName(p.schoolName)}: ${firstName(p.studentName)}'s fees of NGN ${amount(p.balance)} are ` +
    `${overdueDays} day${overdueDays === 1 ? '' : 's'} overdue. Please pay to ${payToPhrase(p.accountNumber, p.bankName)}.`
  )
}export interface EmailBody {
  subject: string
  html: string
  text: string
}

// Palette tokens, matched to the modernist design system (see mockup
// redesign/_ds/.../readme.md). Emails can't load an external stylesheet or
// read CSS variables, so these are the literal hex values, inlined on every
// element the way email clients require.
const INK = '#201e1d'
const SECONDARY = '#605d5d'
const BODY_TEXT = '#444141'
const SURFACE = '#eae9e9'
const PAPER = '#f3f2f2'
const RULE = '#d7d3d3'
const OCHRE = '#8a4805'
const GREEN = '#0a6b3d'
const EMAIL_FONT = 'font-family: Arial, Helvetica, sans-serif;'

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const chars = words.slice(0, 2).map((w) => w[0]?.toUpperCase() || '')
  return chars.join('') || '?'
}

// A 44px square, bordered in ink, either holding the school's uploaded logo
// or its initials. The header keeps the same shape either way, rather than
// the current build's mix of "logo image" and "just the name in text."
function logoCell(schoolName: string, logoUrl?: string | null): string {
  if (logoUrl) {
    return (
      `<img src="${logoUrl}" alt="${schoolName}" width="44" height="44" ` +
      `style="display:block; width:44px; height:44px; object-fit:contain; border:2px solid ${INK};" />`
    )
  }
  return (
    `<table role="presentation" width="44" cellpadding="0" cellspacing="0" style="border:2px solid ${INK};">` +
    `<tr><td align="center" valign="middle" height="44" style="width:44px; height:44px; font-size:15px; font-weight:bold; color:${INK}; ${EMAIL_FONT}">${initials(schoolName)}</td></tr>` +
    `</table>`
  )
}

function emailShell(borderColor: string, innerRowsHtml: string): string {
  return (
    `<!DOCTYPE html>` +
    `<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/></head>` +
    `<body style="margin:0; padding:0; background-color:${SURFACE}; ${EMAIL_FONT}">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${SURFACE};"><tr><td align="center" style="padding:32px 16px;">` +
    `<table role="presentation" width="680" cellpadding="0" cellspacing="0" style="max-width:680px; width:100%; background-color:#ffffff; border:2px solid ${borderColor};">` +
    innerRowsHtml +
    `</table>` +
    `</td></tr></table>` +
    `</body></html>`
  )
}

function headerRow(schoolName: string, kicker: string, borderColor: string, logoUrl?: string | null): string {
  return (
    `<tr><td style="padding:20px 28px 18px; border-bottom:2px solid ${borderColor};">` +
    `<table role="presentation" cellpadding="0" cellspacing="0"><tr>` +
    `<td style="vertical-align:top; padding-right:14px;">${logoCell(schoolName, logoUrl)}</td>` +
    `<td style="vertical-align:top;">` +
    `<p style="margin:0; color:${INK}; font-size:19px; font-weight:bold; ${EMAIL_FONT}">${schoolName}</p>` +
    `<p style="margin:5px 0 0; color:${SECONDARY}; font-size:11px; letter-spacing:0.14em; ${EMAIL_FONT}">${kicker}</p>` +
    `</td></tr></table>` +
    `</td></tr>`
  )
}

function ledgerRow(label: string, value: string, valueColor: string = INK): string {
  return (
    `<tr>` +
    `<td style="padding:9px 0; border-bottom:1px solid ${RULE}; color:${SECONDARY}; font-size:13px; ${EMAIL_FONT}">${label}</td>` +
    `<td style="padding:9px 0; border-bottom:1px solid ${RULE}; text-align:right; color:${valueColor}; font-size:14px; font-weight:bold; ${EMAIL_FONT}">${value}</td>` +
    `</tr>`
  )
}

function ledgerTable(rowsHtml: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rowsHtml}</table>`
}

function noteParagraph(text: string): string {
  return `<p style="margin:16px 0 0; color:${BODY_TEXT}; font-size:13px; line-height:1.6; ${EMAIL_FONT}">${text}</p>`
}

function footerRow(schoolName: string): string {
  return (
    `<tr><td style="padding:16px 28px; background-color:${INK};">` +
    `<p style="margin:0; color:${RULE}; font-size:12px; line-height:1.6; ${EMAIL_FONT}">Sent by <strong style="color:#ffffff;">${schoolName}</strong> through Fees101. Not expecting this? Contact the school office.</p>` +
    `</td></tr>`
  )
}

export function composeInvoiceEmail(p: InvoiceMessageParams): EmailBody {
  const schoolName = p.schoolName
  const student = firstName(p.studentName)
  const isUpdate = !!p.isUpdate
  const dueLine = emailDueLine(p.dueDate)
  const countdown = countdownPhrase(daysUntil(p.dueDate))
  const subject = isUpdate
    ? `${student}'s ${p.termName} fees (updated): ${nairaAmount(p.amountDue)} due ${dateNoYear(p.dueDate)}`
    : `${student}'s ${p.termName} fees: ${nairaAmount(p.amountDue)} due ${dateNoYear(p.dueDate)}`

  const showCreditNote = isUpdate && ((p.creditApplied || 0) > 0 || (p.creditBalance || 0) > 0)
  const breakdown = p.lineItems || []

  const text =
    `${schoolName}\n${p.termName.toUpperCase()} FEES INVOICE\n\n` +
    (isUpdate ? `This invoice for ${p.studentName} has been updated.\n\n` : '') +
    `Amount due: ${nairaAmount(p.amountDue)}\n` +
    `By ${dueLine} (${countdown})\n\n` +
    `Pay into: ${spacedAccountNumber(p.accountNumber)}, ${p.bankName}\n` +
    `This account belongs to ${student} only and credits automatically, usually within a few minutes.\n\n` +
    `Student: ${p.studentName}\n` +
    (p.className ? `Class: ${p.className}\n` : '') +
    `Term: ${p.termName}\n` +
    (showCreditNote
      ? `Credit applied: ${nairaAmount(p.creditApplied || 0)}\nAccount credit balance: ${nairaAmount(p.creditBalance || 0)}\n`
      : '') +
    (breakdown.length > 0
      ? `\nFee breakdown:\n${breakdown.map((li) => `  ${li.name}: ${nairaAmountSigned(li.amount)}`).join('\n')}\n`
      : '') +
    `\nThe full breakdown is attached as a PDF. Already paid? Ignore this, it crossed in the post.\n\n` +
    `Sent by ${schoolName} through Fees101. Not expecting this? Contact the school office.`

  const ledgerRows =
    ledgerRow('Student', p.studentName) +
    (p.className ? ledgerRow('Class', p.className) : '') +
    ledgerRow('Term', p.termName) +
    (showCreditNote
      ? ledgerRow('Credit applied', nairaAmount(p.creditApplied || 0), GREEN) +
        ledgerRow('Account credit balance', nairaAmount(p.creditBalance || 0))
      : '') +
    breakdown.map((li) => ledgerRow(li.name, nairaAmountSigned(li.amount), li.amount < 0 ? GREEN : INK)).join('')


  const html = emailShell(
    INK,
    headerRow(schoolName, `${p.termName.toUpperCase()} · FEES INVOICE`, INK, p.logoUrl) +
    `<tr><td style="padding:26px 28px 22px;">` +
    `<p style="margin:0 0 6px; color:${SECONDARY}; font-size:11px; letter-spacing:0.14em; ${EMAIL_FONT}">AMOUNT DUE</p>` +
    `<p style="margin:0 0 4px; color:${INK}; font-size:36px; font-weight:bold; letter-spacing:-0.02em; ${EMAIL_FONT}">${nairaAmount(p.amountDue)}</p>` +
    `<p style="margin:0; color:${OCHRE}; font-size:14px; font-weight:bold; ${EMAIL_FONT}">By ${dueLine} · ${countdown}</p>` +
    `</td></tr>` +
    `<tr><td style="border-top:2px solid ${INK}; border-bottom:2px solid ${INK}; background-color:${PAPER}; padding:20px 28px;">` +
    `<p style="margin:0 0 10px; color:${SECONDARY}; font-size:11px; letter-spacing:0.14em; ${EMAIL_FONT}">PAY INTO THIS ACCOUNT</p>` +
    `<p style="margin:0 0 2px; color:${INK}; font-size:24px; font-weight:bold; letter-spacing:0.02em; ${EMAIL_FONT}">${spacedAccountNumber(p.accountNumber)}</p>` +
    `<p style="margin:0; color:${BODY_TEXT}; font-size:14px; ${EMAIL_FONT}">${p.bankName}</p>` +
    `<p style="margin:10px 0 0; color:${SECONDARY}; font-size:13px; line-height:1.5; ${EMAIL_FONT}">This account belongs to ${student} only. Anything paid into it is credited to the fees automatically, usually within a few minutes.</p>` +
    `</td></tr>` +
    `<tr><td style="padding:22px 28px;">` +
    ledgerTable(ledgerRows) +
    noteParagraph('The full breakdown is attached as a PDF. Already paid? Ignore this, it crossed in the post.') +
    `</td></tr>` +
    footerRow(schoolName)
  )

  return { subject, html, text }
}

export function composeFullPaymentEmail(p: FullPaymentMessageParams): EmailBody {
  const student = firstName(p.studentName)
  const subject = `${student}'s ${p.termName} fees: receipt for ${nairaAmount(p.amountPaid)} received`

  const text =
    `${p.schoolName}\nRECEIPT · ${p.termName.toUpperCase()}\n\n` +
    `Received with thanks: ${nairaAmount(p.amountPaid)}\n` +
    `${student}'s ${p.termName} fees are fully settled. Nothing further is owed this term.\n\n` +
    `Student: ${p.studentName}\n` +
    `Term: ${p.termName}\n` +
    (p.paidAt ? `Paid on: ${emailDateTime(p.paidAt)}\n` : '') +
    (p.accountNumber ? `Account: ${spacedAccountNumber(p.accountNumber)}\n` : '') +
    (p.reference ? `Reference: ${p.reference}\n` : '') +
    `\nThe stamped receipt is attached as a PDF. Keep it, schools ask for it at re-registration.\n\n` +
    `Sent by ${p.schoolName} through Fees101.`

  const html = emailShell(
    GREEN,
    headerRow(p.schoolName, `RECEIPT · ${p.termName.toUpperCase()}`, GREEN, p.logoUrl) +
    `<tr><td style="padding:26px 28px 22px;">` +
    `<p style="margin:0 0 6px; color:${SECONDARY}; font-size:11px; letter-spacing:0.14em; ${EMAIL_FONT}">RECEIVED WITH THANKS</p>` +
    `<p style="margin:0 0 6px; color:${GREEN}; font-size:36px; font-weight:bold; letter-spacing:-0.02em; ${EMAIL_FONT}">${nairaAmount(p.amountPaid)}</p>` +
    `<p style="margin:0; color:${INK}; font-size:15px; font-weight:bold; ${EMAIL_FONT}">${student}'s ${p.termName} fees are fully settled.</p>` +
    `<p style="margin:6px 0 0; color:${SECONDARY}; font-size:14px; ${EMAIL_FONT}">Nothing further is owed this term.</p>` +
    `</td></tr>` +
    `<tr><td style="border-top:2px solid ${RULE}; padding:20px 28px;">` +
    ledgerTable(
      ledgerRow('Student', p.studentName) +
      ledgerRow('Term', p.termName) +
      (p.paidAt ? ledgerRow('Paid on', emailDateTime(p.paidAt)) : '') +
      (p.accountNumber ? ledgerRow('Account', spacedAccountNumber(p.accountNumber)) : '') +
      (p.reference ? ledgerRow('Reference', p.reference) : '')
    ) +
    noteParagraph('The stamped receipt is attached as a PDF. Keep it, schools ask for it at re-registration.') +
    `</td></tr>` +
    footerRow(p.schoolName)
  )

  return { subject, html, text }
}

export function composePartialPaymentEmail(p: PartialPaymentMessageParams): EmailBody {
  const student = firstName(p.studentName)
  const subject = `${student}'s fees: ${nairaAmount(p.amountPaid)} received, balance ${nairaAmount(p.balance)}`

  const text =
    `${p.schoolName}\nPAYMENT RECEIVED\n\n` +
    `Received: ${nairaAmount(p.amountPaid)}\n` +
    `Balance still to pay: ${nairaAmount(p.balance)}\n` +
    (p.dueDate ? `Balance due by: ${emailDueLine(p.dueDate)}\n` : '') +
    `\nStudent: ${p.studentName}\n` +
    `Pay the balance into: ${spacedAccountNumber(p.accountNumber)}\n\n` +
    `Your receipt for this payment is attached as a PDF for your records.\n\n` +
    `Sent by ${p.schoolName} through Fees101.`

  const html = emailShell(
    INK,
    headerRow(p.schoolName, 'PAYMENT RECEIVED', INK, p.logoUrl) +
    `<tr><td style="padding:26px 28px 22px;">` +
    `<p style="margin:0 0 6px; color:${SECONDARY}; font-size:11px; letter-spacing:0.14em; ${EMAIL_FONT}">RECEIVED</p>` +
    `<p style="margin:0 0 6px; color:${GREEN}; font-size:32px; font-weight:bold; letter-spacing:-0.02em; ${EMAIL_FONT}">${nairaAmount(p.amountPaid)}</p>` +
    `<p style="margin:0; color:${OCHRE}; font-size:15px; font-weight:bold; ${EMAIL_FONT}">${nairaAmount(p.balance)} still to pay${p.dueDate ? ` by ${emailDueLine(p.dueDate)}` : ''}</p>` +
    `</td></tr>` +
    `<tr><td style="border-top:2px solid ${INK}; border-bottom:2px solid ${INK}; background-color:${PAPER}; padding:20px 28px;">` +
    `<p style="margin:0 0 10px; color:${SECONDARY}; font-size:11px; letter-spacing:0.14em; ${EMAIL_FONT}">PAY THE BALANCE INTO</p>` +
    `<p style="margin:0; color:${INK}; font-size:22px; font-weight:bold; letter-spacing:0.02em; ${EMAIL_FONT}">${spacedAccountNumber(p.accountNumber)}</p>` +
    `</td></tr>` +
    `<tr><td style="padding:22px 28px;">` +
    ledgerTable(ledgerRow('Student', p.studentName)) +
    noteParagraph('Your receipt for this payment is attached as a PDF for your records.') +
    `</td></tr>` +
    footerRow(p.schoolName)
  )

  return { subject, html, text }
}

export function composeReminderEmail(p: ReminderMessageParams): EmailBody {
  const student = firstName(p.studentName)
  const dueLine = emailDueLine(p.dueDate)
  const countdown = countdownPhrase(daysUntil(p.dueDate))
  const subject = `${student}'s ${p.termName} fees: ${nairaAmount(p.balance)} due ${dateNoYear(p.dueDate)}`

  const text =
    `${p.schoolName}\nFEES REMINDER · ${p.termName.toUpperCase()}\n\n` +
    `Amount due: ${nairaAmount(p.balance)}\n` +
    `By ${dueLine} (${countdown})\n\n` +
    `Pay into: ${spacedAccountNumber(p.accountNumber)}${p.bankName ? `, ${p.bankName}` : ''}\n\n` +
    `Student: ${p.studentName}\nTerm: ${p.termName}\n\n` +
    `Already paid? Ignore this, it crossed in the post.\n\n` +
    `Sent by ${p.schoolName} through Fees101. Not expecting this? Contact the school office.`

  const html = emailShell(
    INK,
    headerRow(p.schoolName, `${p.termName.toUpperCase()} · FEES REMINDER`, INK) +
    `<tr><td style="padding:26px 28px 22px;">` +
    `<p style="margin:0 0 6px; color:${SECONDARY}; font-size:11px; letter-spacing:0.14em; ${EMAIL_FONT}">AMOUNT DUE</p>` +
    `<p style="margin:0 0 4px; color:${INK}; font-size:36px; font-weight:bold; letter-spacing:-0.02em; ${EMAIL_FONT}">${nairaAmount(p.balance)}</p>` +
    `<p style="margin:0; color:${OCHRE}; font-size:14px; font-weight:bold; ${EMAIL_FONT}">By ${dueLine} · ${countdown}</p>` +
    `</td></tr>` +
    `<tr><td style="border-top:2px solid ${INK}; border-bottom:2px solid ${INK}; background-color:${PAPER}; padding:20px 28px;">` +
    `<p style="margin:0 0 10px; color:${SECONDARY}; font-size:11px; letter-spacing:0.14em; ${EMAIL_FONT}">PAY INTO THIS ACCOUNT</p>` +
    `<p style="margin:0 0 2px; color:${INK}; font-size:24px; font-weight:bold; letter-spacing:0.02em; ${EMAIL_FONT}">${spacedAccountNumber(p.accountNumber)}</p>` +
    (p.bankName ? `<p style="margin:0; color:${BODY_TEXT}; font-size:14px; ${EMAIL_FONT}">${p.bankName}</p>` : '') +
    `</td></tr>` +
    `<tr><td style="padding:22px 28px;">` +
    ledgerTable(ledgerRow('Student', p.studentName) + ledgerRow('Term', p.termName)) +
    noteParagraph('Already paid? Ignore this, it crossed in the post.') +
    `</td></tr>` +
    footerRow(p.schoolName)
  )

  return { subject, html, text }
}

export function composeOverdueEmail(p: ReminderMessageParams): EmailBody {
  const student = firstName(p.studentName)
  const overdueDays = Math.max(1, -daysUntil(p.dueDate))
  const subject = `${student}'s ${p.termName} fees: ${nairaAmount(p.balance)} overdue`

  const text =
    `${p.schoolName}\nFEES OVERDUE · ${p.termName.toUpperCase()}\n\n` +
    `Amount overdue: ${nairaAmount(p.balance)}\n` +
    `${overdueDays} day${overdueDays === 1 ? '' : 's'} past the due date\n\n` +
    `Pay into: ${spacedAccountNumber(p.accountNumber)}${p.bankName ? `, ${p.bankName}` : ''}\n\n` +
    `Student: ${p.studentName}\nTerm: ${p.termName}\n\n` +
    `Already paid? Ignore this, it crossed in the post.\n\n` +
    `Sent by ${p.schoolName} through Fees101. Not expecting this? Contact the school office.`

  const html = emailShell(
    OCHRE,
    headerRow(p.schoolName, `${p.termName.toUpperCase()} · FEES OVERDUE`, OCHRE) +
    `<tr><td style="padding:26px 28px 22px;">` +
    `<p style="margin:0 0 6px; color:${SECONDARY}; font-size:11px; letter-spacing:0.14em; ${EMAIL_FONT}">AMOUNT OVERDUE</p>` +
    `<p style="margin:0 0 4px; color:${OCHRE}; font-size:36px; font-weight:bold; letter-spacing:-0.02em; ${EMAIL_FONT}">${nairaAmount(p.balance)}</p>` +
    `<p style="margin:0; color:${OCHRE}; font-size:14px; font-weight:bold; ${EMAIL_FONT}">${overdueDays} day${overdueDays === 1 ? '' : 's'} past the due date</p>` +
    `</td></tr>` +
    `<tr><td style="border-top:2px solid ${OCHRE}; border-bottom:2px solid ${OCHRE}; background-color:${PAPER}; padding:20px 28px;">` +
    `<p style="margin:0 0 10px; color:${SECONDARY}; font-size:11px; letter-spacing:0.14em; ${EMAIL_FONT}">PAY INTO THIS ACCOUNT</p>` +
    `<p style="margin:0 0 2px; color:${INK}; font-size:24px; font-weight:bold; letter-spacing:0.02em; ${EMAIL_FONT}">${spacedAccountNumber(p.accountNumber)}</p>` +
    (p.bankName ? `<p style="margin:0; color:${BODY_TEXT}; font-size:14px; ${EMAIL_FONT}">${p.bankName}</p>` : '') +
    `</td></tr>` +
    `<tr><td style="padding:22px 28px;">` +
    ledgerTable(ledgerRow('Student', p.studentName) + ledgerRow('Term', p.termName)) +
    noteParagraph('Already paid? Ignore this, it crossed in the post.') +
    `</td></tr>` +
    footerRow(p.schoolName)
  )

  return { subject, html, text }
}

