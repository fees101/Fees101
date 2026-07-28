// Message text for every outbound message type.
//
// SMS: sent under our approved custom Sender ID ("OE Alert" — see
// TERMII_SENDER_ID). "NGN" (not the ₦ sign) keeps SMS in the cheap GSM-7
// encoding — ₦ forces costlier Unicode segments.
//
// Email compose functions (SMTP + PDF attachment) were removed along with the
// rest of the SMTP email sender — see src/lib/messaging/sendMessage.ts. Will
// be rebuilt against Amazon SES.

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
