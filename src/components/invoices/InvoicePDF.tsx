import path from 'path'
import { Document, Page, Text, View, StyleSheet, Image, Font } from '@react-pdf/renderer'
import { InvoiceDetail } from '@/lib/queries/fees'

// Helvetica (react-pdf's default) has no glyph for the Naira sign (U+20A6).
// DejaVu Sans has full currency-symbol coverage, so we embed it instead.
Font.register({
  family: 'DejaVuSans',
  fonts: [
    { src: path.join(process.cwd(), 'public/fonts/DejaVuSans.ttf'), fontWeight: 'normal' },
    { src: path.join(process.cwd(), 'public/fonts/DejaVuSans-Bold.ttf'), fontWeight: 'bold' },
  ],
})

// Modernist palette (react-pdf takes literal hex, no CSS variables).
const INK = '#201e1d'
const PAPER = '#f3f2f2'
const SECONDARY = '#605d5d'
const BODY = '#444141'
const DIVIDER = '#d7d3d3'
const ACCENT_SMALL = '#ae1800'
const GREEN = '#0a6b3d'
const OCHRE_TEXT = '#8a4805'

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontFamily: 'DejaVuSans',
    fontSize: 10,
    color: INK,
    backgroundColor: PAPER,
  },

  // Masthead
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 20,
    paddingBottom: 14,
    borderBottomWidth: 2,
    borderBottomColor: INK,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'flex-start', flex: 1, marginRight: 16 },
  logoBox: {
    width: 44,
    height: 44,
    borderWidth: 2,
    borderColor: INK,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    flexShrink: 0,
  },
  logoImage: { width: 44, height: 44, borderWidth: 2, borderColor: INK, marginRight: 12, flexShrink: 0 },
  logoInitials: { fontSize: 12, fontWeight: 'bold', color: INK },
  schoolTextBlock: { flexShrink: 1 },
  schoolName: { fontSize: 15, fontWeight: 'bold', color: INK, marginBottom: 4 },
  schoolInfo: { fontSize: 9, color: SECONDARY, lineHeight: 1.5 },
  headerRight: { alignItems: 'flex-end', flexShrink: 0 },

  invoiceTitle: { fontSize: 10, fontWeight: 'bold', letterSpacing: 1.6, color: INK, textTransform: 'uppercase', marginBottom: 3 },
  invoiceNumber: { fontSize: 12, fontWeight: 'bold', color: INK },

  // Billed to / term
  detailsRow: {
    flexDirection: 'row',
    gap: 24,
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderBottomColor: DIVIDER,
  },
  colWide: { flex: 1.3 },
  colNarrow: { flex: 1 },
  detailsLabel: { fontSize: 9, fontWeight: 'bold', letterSpacing: 1.2, color: SECONDARY, textTransform: 'uppercase', marginBottom: 5 },
  detailsName: { fontSize: 13, fontWeight: 'bold', color: INK, marginBottom: 3 },
  detailsBody: { fontSize: 10, color: BODY, lineHeight: 1.5 },

  // Amount due / pay into
  amountRow: {
    flexDirection: 'row',
    gap: 24,
    paddingTop: 20,
    paddingBottom: 18,
    borderBottomWidth: 2,
    borderBottomColor: INK,
  },
  amountFigure: { fontSize: 32, fontWeight: 'bold', color: INK, marginBottom: 4, letterSpacing: -1, lineHeight: 0.95 },
  amountSublineOchre: { fontSize: 11, fontWeight: 'bold', color: OCHRE_TEXT },
  amountSublineRed: { fontSize: 11, fontWeight: 'bold', color: ACCENT_SMALL },
  amountSublineGreen: { fontSize: 11, fontWeight: 'bold', color: GREEN },
  amountSublineSecondary: { fontSize: 11, fontWeight: 'bold', color: SECONDARY },
  accountNumber: { fontSize: 17, fontWeight: 'bold', color: INK, letterSpacing: 0.4, marginBottom: 3 },

  // Line items
  itemsWrap: { marginTop: 16 },
  itemHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: INK,
  },
  itemHeaderLabel: { fontSize: 9, fontWeight: 'bold', letterSpacing: 1, color: SECONDARY, textTransform: 'uppercase' },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: DIVIDER,
  },
  itemNameWrap: { flexDirection: 'row', alignItems: 'baseline', flexShrink: 1, marginRight: 12 },
  itemName: { fontSize: 11 },
  itemTag: { fontSize: 8, fontWeight: 'bold', letterSpacing: 0.8, color: SECONDARY, textTransform: 'uppercase', marginLeft: 8 },
  itemAmount: { fontSize: 11, flexShrink: 0, textAlign: 'right' },

  totalBilledRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 2,
    borderBottomColor: INK,
  },
  totalBilledLabel: { fontSize: 10.5, fontWeight: 'bold', color: INK },
  totalBilledValue: { fontSize: 13, fontWeight: 'bold', color: INK },

  paidRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: DIVIDER,
  },
  paidLabel: { fontSize: 10.5, color: BODY },
  paidValue: { fontSize: 10.5, fontWeight: 'bold', color: GREEN },

  stillToPayRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingTop: 10,
  },
  stillToPayLabel: { fontSize: 12.5, fontWeight: 'bold', color: INK },
  stillToPayValue: { fontSize: 17, fontWeight: 'bold', color: INK },

  footer: {
    marginTop: 26,
    fontSize: 9,
    color: SECONDARY,
    borderTopWidth: 1,
    borderTopColor: DIVIDER,
    paddingTop: 9,
  },
  footerLine: { lineHeight: 1.6 },
})

function formatNaira(amount: number): string {
  return (amount < 0 ? '-₦' : '₦') + Math.abs(amount).toLocaleString('en-NG')
}

function formatDateShort(dateStr: string | null): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatDateLong(dateStr: string | null): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

// Groups a NUBAN-style account number as "1234 567 890" for readability;
// falls back to plain 3-digit grouping for anything non-standard.
function formatAccountNumber(accountNumber: string): string {
  const digits = accountNumber.replace(/\s+/g, '')
  if (digits.length === 10) {
    return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`
  }
  return digits.replace(/(\d{3})(?=\d)/g, '$1 ').trim()
}

function daysBetween(later: Date, earlier: Date): number {
  return Math.round((later.getTime() - earlier.getTime()) / 86_400_000)
}

function getSchoolInitials(name: string): string {
  const words = name.split(/\s+/).filter(w => w.length > 0)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

// Short word tag shown beside a line item's name — carries the same
// information as the colour, so the document still reads correctly if
// printed in black and white.
function lineItemTag(kind?: string): string | null {
  switch (kind) {
    case 'opt_in': return 'Optional'
    case 'previous_balance': return 'Carried'
    case 'credit_applied': return 'Not a payment'
    default: return null
  }
}

function lineItemColor(kind?: string): string {
  switch (kind) {
    case 'previous_balance': return OCHRE_TEXT
    case 'credit_applied': return GREEN
    default: return INK
  }
}

interface Props {
  invoice: InvoiceDetail
  logoUrl?: string | null
}

export function InvoicePage({ invoice, logoUrl }: Props) {
  const initials = getSchoolInitials(invoice.schoolName)

  const rows: Array<{ name: string, amount: number, tag: string | null, color: string }> = [
    ...invoice.lineItems.map(item => ({
      name: item.name,
      amount: item.amount,
      tag: lineItemTag(item.kind),
      color: lineItemColor(item.kind),
    })),
    ...(invoice.discountAmount > 0
      ? [{ name: invoice.discountReason || 'Discount', amount: -invoice.discountAmount, tag: 'Discount', color: INK }]
      : []),
  ]

  // The dominant "amount due" tile doubles as a receipt once the invoice is
  // settled — the same document is reused for both (see renderInvoicePdf.ts).
  const isSettled = invoice.outstandingAmount <= 0
  let amountLabel = 'Amount due'
  let amountFigure = invoice.outstandingAmount
  let amountSubline: React.ReactNode = null

  if (isSettled) {
    amountLabel = 'Amount paid'
    amountFigure = invoice.paidAmount
    amountSubline = (
      <Text style={styles.amountSublineGreen}>
        {invoice.fullyPaidAt ? `Paid in full on ${formatDateShort(invoice.fullyPaidAt)}` : 'Paid in full'}
      </Text>
    )
  } else if (invoice.cycleStatus === 'closed' && invoice.status === 'cancelled') {
    amountLabel = 'Amount billed'
    amountFigure = invoice.totalAmount
    amountSubline = <Text style={styles.amountSublineSecondary}>Cancelled</Text>
  } else if (invoice.status === 'overdue' && invoice.cycleDueDate) {
    const days = daysBetween(new Date(invoice.generatedAt), new Date(invoice.cycleDueDate))
    amountSubline = (
      <Text style={styles.amountSublineRed}>
        {days > 0 ? `${days} day${days === 1 ? '' : 's'} overdue` : 'Overdue'}
      </Text>
    )
  } else if (invoice.cycleDueDate) {
    amountSubline = <Text style={styles.amountSublineOchre}>By {formatDateLong(invoice.cycleDueDate)}</Text>
  }

  return (
    <Page size="A4" style={styles.page}>

      {/* Masthead */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          {logoUrl ? (
            <Image src={logoUrl} style={styles.logoImage} />
          ) : (
            <View style={styles.logoBox}>
              <Text style={styles.logoInitials}>{initials}</Text>
            </View>
          )}
          <View style={styles.schoolTextBlock}>
            <Text style={styles.schoolName}>{invoice.schoolName}</Text>
            {(invoice.schoolAddress || invoice.schoolPhone) && (
              <Text style={styles.schoolInfo}>
                {[invoice.schoolAddress, invoice.schoolPhone].filter(Boolean).join(' · ')}
              </Text>
            )}
          </View>
        </View>

        <View style={styles.headerRight}>
          <Text style={styles.invoiceTitle}>Invoice</Text>
          <Text style={styles.invoiceNumber}>{invoice.invoiceNumber || '—'}</Text>
        </View>
      </View>

      {/* Billed to / term */}
      <View style={styles.detailsRow}>
        <View style={styles.colWide}>
          <Text style={styles.detailsLabel}>Billed to</Text>
          <Text style={styles.detailsName}>{invoice.studentFirstName} {invoice.studentLastName}</Text>
          <Text style={styles.detailsBody}>{invoice.className} · {invoice.studentAdmissionNumber}</Text>
          {invoice.primaryParentName ? (
            <Text style={styles.detailsBody}>
              {invoice.primaryParentName}{invoice.primaryParentPhone ? ` · ${invoice.primaryParentPhone}` : ''}
            </Text>
          ) : null}
        </View>
        <View style={styles.colNarrow}>
          <Text style={styles.detailsLabel}>Term</Text>
          <Text style={styles.detailsName}>{invoice.cycleName}</Text>
          <Text style={styles.detailsBody}>Issued {formatDateShort(invoice.generatedAt)}</Text>
        </View>
      </View>

      {/* Amount due / pay into */}
      <View style={styles.amountRow}>
        <View style={styles.colWide}>
          <Text style={styles.detailsLabel}>{amountLabel}</Text>
          <Text style={styles.amountFigure}>{formatNaira(amountFigure)}</Text>
          {amountSubline}
        </View>
        <View style={styles.colNarrow}>
          <Text style={styles.detailsLabel}>Pay into</Text>
          {invoice.dvaAccountNumber ? (
            <>
              <Text style={styles.accountNumber}>{formatAccountNumber(invoice.dvaAccountNumber)}</Text>
              <Text style={styles.detailsBody}>
                {invoice.dvaBankName ? `${invoice.dvaBankName} · ` : ''}
                this account belongs to {invoice.studentFirstName} only and credits fees automatically.
              </Text>
            </>
          ) : (
            <Text style={styles.detailsBody}>
              Please reach out to the school to generate a payment account for this student.
            </Text>
          )}
        </View>
      </View>

      {/* Line items */}
      <View style={styles.itemsWrap}>
        <View style={styles.itemHeaderRow}>
          <Text style={styles.itemHeaderLabel}>Item</Text>
          <Text style={styles.itemHeaderLabel}>Amount</Text>
        </View>
        {rows.map((row, idx) => (
          <View key={idx} style={styles.itemRow}>
            <View style={styles.itemNameWrap}>
              <Text style={[styles.itemName, { color: row.color }]}>{row.name}</Text>
              {row.tag && <Text style={styles.itemTag}>{row.tag}</Text>}
            </View>
            <Text style={[styles.itemAmount, { color: row.color }]}>{formatNaira(row.amount)}</Text>
          </View>
        ))}

        <View style={styles.totalBilledRow}>
          <Text style={styles.totalBilledLabel}>Total billed</Text>
          <Text style={styles.totalBilledValue}>{formatNaira(invoice.totalAmount)}</Text>
        </View>
        <View style={styles.paidRow}>
          <Text style={styles.paidLabel}>Paid so far</Text>
          <Text style={styles.paidValue}>− {formatNaira(invoice.paidAmount)}</Text>
        </View>
        <View style={styles.stillToPayRow}>
          <Text style={styles.stillToPayLabel}>Still to pay</Text>
          <Text style={styles.stillToPayValue}>{formatNaira(invoice.outstandingAmount)}</Text>
        </View>
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerLine}>
          {invoice.schoolName} · Invoice {invoice.invoiceNumber || '—'} · generated {formatDateShort(invoice.generatedAt)} · page 1 of 1
        </Text>
        {invoice.schoolPhone && (
          <Text style={styles.footerLine}>
            Questions about this invoice: call the school office on {invoice.schoolPhone}.
          </Text>
        )}
      </View>
    </Page>
  )
}

export default function InvoicePDF({ invoice, logoUrl }: Props) {
  return (
    <Document>
      <InvoicePage invoice={invoice} logoUrl={logoUrl} />
    </Document>
  )
}
